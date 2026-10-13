import { parse } from "yaml";
import { normalizeUrl } from "../collect/identity.js";
import type { SealedDelivery } from "./types.js";
function declaredURL(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const raw =
    /^<([^<>\s]+)>$/.exec(text)?.[1] ??
    /^\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)$/.exec(
      text,
    )?.[1] ??
    text;
  if (/\s/.test(raw)) return null;
  try {
    return normalizeUrl(raw);
  } catch {
    return null;
  }
}
/** Primary metadata only. Ordinary quotations, code examples and supplemental links do not define article identity. */
export function primarySourceURLs(markdown: string): Set<string> {
  const primary = new Set<string>();
  let body = markdown.replace(/^\uFEFF/, "");
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body);
  if (front) {
    try {
      const value: unknown = parse(front[1]!, { maxAliasCount: 0 });
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const fields = value as Record<string, unknown>;
        for (const key of ["source", "source_url"]) {
          const url = declaredURL(fields[key]);
          if (url) primary.add(url);
        }
      }
    } catch {
      /* Malformed metadata is not proof of a duplicate. */
    }
    body = body.slice(front[0].length);
  }
  // Code fences and HTML comments are source material, not note metadata.
  body = body.replace(/<!--[\s\S]*?-->/g, "");
  let fence: { marker: string; length: number } | null = null;
  for (const line of body.split(/\r?\n/)) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    const token = match?.[1];
    if (token) {
      if (!fence) fence = { marker: token[0]!, length: token.length };
      else if (
        token[0] === fence.marker &&
        token.length >= fence.length &&
        !line.slice(match![0].length).trim()
      )
        fence = null;
      continue;
    }
    if (fence || /^\s*>/.test(line) || /^(?: {4}|\t)/.test(line)) continue;
    const clean = line.trim().replace(/^[-*]\s+/, "");
    const directive =
      /^(?:\*\*)?(?:原文(?:链接|来源)?|原始来源|主来源|Original source|Primary source)(?:\*\*)?\s*[:：]\s*(.+)$/i.exec(
        clean,
      );
    const based = /^\*?注[：:]\s*本笔记基于\s*(.+?)\s*编写[。.]?\*?$/.exec(
      clean,
    );
    const url = declaredURL(directive?.[1] ?? based?.[1]);
    if (url) primary.add(url);
  }
  return primary;
}
export function samePrimarySource(
  markdown: string,
  delivery: Pick<SealedDelivery, "sources" | "primary_source_aliases">,
): boolean {
  if (!delivery.sources[0]) return false;
  const article = new Set(
    [delivery.sources[0], ...(delivery.primary_source_aliases ?? [])].map(
      normalizeUrl,
    ),
  );
  return [...primarySourceURLs(markdown)].some((url) => article.has(url));
}
