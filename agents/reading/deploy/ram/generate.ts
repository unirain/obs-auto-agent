import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export interface RAMStatement {
  Effect: "Allow" | "Deny";
  Action: string[];
  Resource: string[];
  Condition?: { StringLike: { "oss:Prefix": string[] } };
}
export interface RAMPolicy {
  Version: "1";
  Statement: RAMStatement[];
}
export interface RAMPolicyBindings {
  workspace_bucket: string;
  image_bucket: string;
  production_prefix: string;
  preview_prefix: string;
  integration_prefix: string;
  image_prefix: string;
}
const bucketResource = (bucket: string) => `acs:oss:*:*:${bucket}`;
const objectResource = (bucket: string, prefix: string) =>
  `${bucketResource(bucket)}/${prefix}*`;
const bucketReads = [
  "oss:GetBucketAcl",
  "oss:GetBucketVersioning",
  "oss:GetBucketLifecycle",
  "oss:GetBucketPolicy",
];
const validate = (b: RAMPolicyBindings) => {
  for (const bucket of [b.workspace_bucket, b.image_bucket])
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))
      throw new Error("Invalid RAM bucket binding");
  for (const prefix of [
    b.production_prefix,
    b.preview_prefix,
    b.integration_prefix,
    b.image_prefix,
  ])
    if (
      !prefix.endsWith("/") ||
      prefix.startsWith("/") ||
      prefix.includes("..") ||
      prefix.includes("\\") ||
      prefix.includes("*") ||
      prefix
        .split("/")
        .slice(0, -1)
        .some((s) => !s)
    )
      throw new Error("Invalid RAM prefix binding");
};
const list = (
  bucket: string,
  prefixes: string[],
  versions = false,
): RAMStatement => ({
  Effect: "Allow",
  Action: versions
    ? ["oss:ListObjects", "oss:ListObjectVersions"]
    : ["oss:ListObjects"],
  Resource: [bucketResource(bucket)],
  Condition: { StringLike: { "oss:Prefix": prefixes.map((p) => p + "*") } },
});
const config = (bucket: string): RAMStatement => ({
  Effect: "Allow",
  Action: bucketReads,
  Resource: [bucketResource(bucket)],
});
function workspaceWriter(bucket: string, prefix: string): RAMPolicy {
  const root = prefix + "obs-notes-hub/";
  return {
    Version: "1",
    Statement: [
      config(bucket),
      list(bucket, [prefix]),
      {
        Effect: "Allow",
        Action: ["oss:GetObject", "oss:PutObject"],
        Resource: [objectResource(bucket, root)],
      },
      {
        Effect: "Allow",
        Action: ["oss:DeleteObject"],
        Resource: [
          `${bucketResource(bucket)}/${root}*/blobs/*`,
          `${bucketResource(bucket)}/${root}*/manifests/*`,
        ],
      },
      {
        Effect: "Deny",
        Action: ["oss:DeleteObject", "oss:DeleteObjectVersion"],
        Resource: [`${bucketResource(bucket)}/${root}*/commits/*`],
      },
    ],
  };
}
export function createRAMPolicies(
  b: RAMPolicyBindings,
): Record<string, RAMPolicy> {
  validate(b);
  const workspacePrefixes = [
    b.production_prefix,
    b.preview_prefix,
    b.integration_prefix,
  ];
  const controls = (prefix: string) => [
    `${bucketResource(b.workspace_bucket)}/${prefix}obs-notes-hub/*/commits/*`,
    `${bucketResource(b.workspace_bucket)}/${prefix}obs-notes-hub/*/manifests/*`,
    `${bucketResource(b.workspace_bucket)}/${prefix}obs-notes-hub/*/blobs/*`,
  ];
  return {
    "preview-workspace": workspaceWriter(b.workspace_bucket, b.preview_prefix),
    "test-workspace": workspaceWriter(b.workspace_bucket, b.integration_prefix),
    "test-image-gc": {
      Version: "1",
      Statement: [
        config(b.image_bucket),
        list(b.image_bucket, [b.image_prefix], true),
        {
          Effect: "Allow",
          Action: [
            "oss:GetObject",
            "oss:DeleteObject",
            "oss:DeleteObjectVersion",
          ],
          Resource: [objectResource(b.image_bucket, b.image_prefix)],
        },
        {
          Effect: "Deny",
          Action: ["oss:PutObject"],
          Resource: [
            `${bucketResource(b.workspace_bucket)}/*`,
            `${bucketResource(b.image_bucket)}/*`,
          ],
        },
        {
          Effect: "Deny",
          Action: ["oss:DeleteObject", "oss:DeleteObjectVersion"],
          Resource: [`${bucketResource(b.workspace_bucket)}/*`],
        },
      ],
    },
    "test-image": {
      Version: "1",
      Statement: [
        config(b.image_bucket),
        list(b.image_bucket, [b.image_prefix], true),
        {
          Effect: "Allow",
          Action: ["oss:GetObject", "oss:PutObject"],
          Resource: [objectResource(b.image_bucket, b.image_prefix)],
        },
        {
          Effect: "Deny",
          Action: ["oss:DeleteObject", "oss:DeleteObjectVersion"],
          Resource: [objectResource(b.image_bucket, b.image_prefix)],
        },
      ],
    },
    "capacity-readonly": {
      Version: "1",
      Statement: [
        config(b.workspace_bucket),
        config(b.image_bucket),
        list(b.workspace_bucket, workspacePrefixes),
        list(b.image_bucket, [b.image_prefix], true),
        {
          Effect: "Allow",
          Action: ["oss:GetObject"],
          Resource: workspacePrefixes.flatMap(controls),
        },
        {
          Effect: "Deny",
          Action: [
            "oss:PutObject",
            "oss:DeleteObject",
            "oss:DeleteObjectVersion",
          ],
          Resource: [
            `${bucketResource(b.workspace_bucket)}/*`,
            `${bucketResource(b.image_bucket)}/*`,
          ],
        },
      ],
    },
    "test-watchdog-readonly": {
      Version: "1",
      Statement: [
        config(b.workspace_bucket),
        list(b.workspace_bucket, [b.integration_prefix]),
        {
          Effect: "Allow",
          Action: ["oss:GetObject"],
          Resource: controls(b.integration_prefix),
        },
        {
          Effect: "Deny",
          Action: [
            "oss:PutObject",
            "oss:DeleteObject",
            "oss:DeleteObjectVersion",
          ],
          Resource: [`${bucketResource(b.workspace_bucket)}/*`],
        },
      ],
    },
  };
}
export const DEFAULT_RAM_BINDINGS: RAMPolicyBindings = {
  workspace_bucket: "obs-agent",
  image_bucket: "configure-image-bucket",
  production_prefix: "reading/production/",
  preview_prefix: "reading/preview/",
  integration_prefix: "reading/integration/",
  image_prefix: "reading-agent/integration/",
};
async function cli(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (key: string) => {
    const i = args.indexOf(key);
    return i < 0 ? undefined : args[i + 1];
  };
  const imageBucket = value("--image-bucket");
  const output = value("--out");
  if (!imageBucket || !output)
    throw new Error(
      "Usage: tsx generate.ts --image-bucket existing-public-image-bucket --out /local/output",
    );
  const policies = createRAMPolicies({
    ...DEFAULT_RAM_BINDINGS,
    image_bucket: imageBucket,
  });
  await mkdir(resolve(output), { recursive: true });
  for (const [name, policy] of Object.entries(policies))
    await writeFile(
      resolve(output, `${name}.json`),
      JSON.stringify(policy, null, 2) + "\n",
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  void cli().catch(() => {
    process.stderr.write(
      "Cannot generate policies: use valid existing bucket and local output arguments.\n",
    );
    process.exitCode = 1;
  });
