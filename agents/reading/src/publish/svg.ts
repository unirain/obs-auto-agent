import { load } from "cheerio";
const allowedTags = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "line",
  "polyline",
  "polygon",
  "circle",
  "ellipse",
  "text",
  "tspan",
  "title",
  "desc",
  "defs",
  "marker",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "pattern",
  "filter",
  "style",
  "image",
  "use",
  "symbol",
  "feblend",
  "fecolormatrix",
  "fecomponenttransfer",
  "fecomposite",
  "feconvolvematrix",
  "fediffuselighting",
  "fedisplacementmap",
  "fedistantlight",
  "fedropshadow",
  "feflood",
  "fefunca",
  "fefuncb",
  "fefuncg",
  "fefuncr",
  "fegaussianblur",
  "femerge",
  "femergenode",
  "femorphology",
  "feoffset",
  "fepointlight",
  "fespecularlighting",
  "fespotlight",
  "fetile",
  "feturbulence",
]);
function safeCSS(value: string): void {
  const stripped = value.replace(/\/\*[\s\S]*?\*\//g, "");
  if (
    /[\\]/.test(stripped) ||
    /@import|@font-face|expression\s*\(|-moz-binding|behavior\s*:|javascript\s*:|vbscript\s*:/i.test(
      stripped,
    )
  )
    throw new Error("Active SVG CSS is forbidden");
  for (const match of stripped.matchAll(/url\s*\(([^)]*)\)/gi))
    if (!/^['"]?#[A-Za-z0-9_.:-]+['"]?$/.test(match[1]!.trim()))
      throw new Error("SVG CSS external resource is forbidden");
}
/** Parse XML and restrict SVG to static, self-contained graphics before upload or delivery. */
export function validateStaticSVG(bytes: Uint8Array): void {
  const text = Buffer.from(bytes).toString("utf8");
  if (
    Buffer.from(text, "utf8").compare(Buffer.from(bytes)) !== 0 ||
    /<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(text)
  )
    throw new Error("SVG entities/processing instructions are forbidden");
  const $ = load(text, { xml: { xmlMode: true, decodeEntities: true } }, false);
  const roots = $.root().children();
  const root = roots.first()[0];
  if (
    roots.length !== 1 ||
    root?.type !== "tag" ||
    root.name.toLowerCase() !== "svg"
  )
    throw new Error("Invalid SVG document root");
  $("*").each((_index, node) => {
    if (node.type !== "tag") throw new Error("Invalid SVG XML node");
    const name = node.name.split(":").at(-1)!.toLowerCase();
    if (!allowedTags.has(name))
      throw new Error(`Active or unsupported SVG element: ${name}`);
    for (const [rawName, value] of Object.entries(node.attribs)) {
      const attribute = rawName.split(":").at(-1)!.toLowerCase();
      if (
        attribute.startsWith("on") ||
        attribute === "src" ||
        attribute === "srcdoc" ||
        attribute === "base" ||
        attribute === "attributename"
      )
        throw new Error("Active SVG attribute is forbidden");
      if (attribute === "href") {
        if (
          !/^#[A-Za-z0-9_.:-]+$/.test(value) &&
          !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
        )
          throw new Error("SVG links and external resources are forbidden");
      }
      if (
        attribute === "style" ||
        ["fill", "stroke", "filter", "clip-path", "mask", "cursor"].includes(
          attribute,
        ) ||
        /url\s*\(/i.test(value) ||
        value.includes("\\")
      )
        safeCSS(value);
      if (/javascript\s*:|vbscript\s*:/i.test(value))
        throw new Error("Active SVG URI is forbidden");
    }
    if (name === "style") safeCSS($(node).text());
  });
}
