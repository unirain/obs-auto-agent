import { expect, it } from "vitest";
import { validateStaticSVG } from "../../src/publish/svg.js";
import { ResourcePublisher } from "../../src/publish/resources.js";
import {
  validateDelivery,
  sha256,
  deliveryValidationHash,
} from "../../src/publish/validate.js";
import { MemoryJournal, sealed } from "./helpers.js";
const attacks = [
  "<script>alert(1)</script>",
  '<g onload="alert(1)"/>',
  '<g ONCLICK="alert(1)"/>',
  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">active</div></foreignObject>',
  '<image href="https://attacker.example/track"/>',
  '<use xlink:href="jav&#x61;script:alert(1)"/>',
  '<set attributeName="href" to="javascript:alert(1)"/>',
  "<style>@import url(https://attacker.example/style)</style>",
  "<style>path { fill: url(https://attacker.example/paint) }</style>",
  "<style>path { fill: u\\72l(https://attacker.example/paint) }</style>",
  '<path fill="u\\72l(https://attacker.example/paint)"/>',
  '<image href="data:image/svg+xml;base64,PHNjcmlwdD4="/>',
];
it.each(attacks)(
  "rejects active/external SVG after XML entity decoding: %s",
  (fragment) => {
    expect(() =>
      validateStaticSVG(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`,
        ),
      ),
    ).toThrow();
  },
);
it("permits static self-contained gradient/marker/CSS and rejects entity expansion and stylesheets", () => {
  expect(() =>
    validateStaticSVG(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="1"/></linearGradient></defs><style>path { fill:url(#g) }</style><path d="M0 0" fill="url(#g)"/></svg>',
      ),
    ),
  ).not.toThrow();
  for (const text of [
    '<!DOCTYPE svg [<!ENTITY p "bad">]><svg/>',
    '<?xml-stylesheet href="https://bad.example/x"?><svg/>',
    "<html/>",
  ])
    expect(() => validateStaticSVG(Buffer.from(text))).toThrow();
});
it("upload and Publisher both reject SHA-correct active SVG before external effects", async () => {
  const bytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  let writes = 0;
  const image = {
    get: async () => null,
    create: async () => {
      writes++;
    },
    url: () => "",
    accessible: async () => true,
  };
  const capacity = {
    reserve: async () => {
      writes++;
    },
    confirm: async () => {},
  };
  await expect(
    new ResourcePublisher(
      image,
      new MemoryJournal(),
      capacity,
      async () => {},
    ).upload({
      project_id: "p",
      first_generated_date: "2026-10-13",
      article_slug: "graph",
      description: "mechanism",
      extension: "svg",
      mime: "image/svg+xml",
      content: bytes,
    }),
  ).rejects.toThrow("SVG element");
  expect(writes).toBe(0);
  const d = sealed();
  d.files.push({
    path: "图文件/graph.svg",
    role: "diagram_source",
    mime: "image/svg+xml",
    bytes: bytes.length,
    sha256: sha256(bytes),
    content: bytes,
  });
  d.validated_hash = deliveryValidationHash(d);
  expect(() =>
    validateDelivery(d, { id: d.workspace_id, revision: d.workspace_revision }),
  ).toThrow("SVG element");
});
