import { readFile, mkdir, writeFile, copyFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHandoff, articleUnits, translationTemplate, imagePlanTemplate, hash } from "./knowledge-handoff.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
if (args.length && (args[0] !== "--locale" || args.length !== 2)) throw new Error("Usage: node scripts/export-knowledge-handoff.mjs [--locale vi]");
const locale = args[1] || "vi";
const bytes = await readFile(path.join(root, "data/knowledge-ja/lessons.json"));
const dataset = JSON.parse(bytes.toString("utf8"));
const colorPath = existsSync(path.join(root, "data/knowledge-ja/color-applied-manifest.json")) ? "data/knowledge-ja/color-applied-manifest.json" : "data/knowledge-ja/color-manifest.json";
const colors = JSON.parse(await readFile(path.join(root, colorPath), "utf8"));
const bundle = createHandoff(dataset, colors, locale, hash(bytes));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/translation-handoff", `mirai-menkyo-${locale}-${stamp}`);
await mkdir(output, { recursive: true });
for (const dir of ["lessons", "return-templates", "media/original", "media/color", "media/tables", "reference", "proposed-images", "assets/icons"])
  await mkdir(path.join(output, dir), { recursive: true });
const json = (file, value) => writeFile(path.join(output, file), JSON.stringify(value, null, 2) + "\n", "utf8");
const inventory = [];
async function asset(source, target, expectedHash) {
  const data = await readFile(path.join(root, source));
  const sha256 = hash(data);
  if (expectedHash && sha256 !== expectedHash) throw new Error(`Changed source asset: ${source}`);
  await writeFile(path.join(output, target), data);
  inventory.push({ path: target, sha256, bytes: data.length });
}
await asset("data/knowledge-ja/source.pdf", "reference/source-ja-2024.pdf", dataset.source.sha256);
await asset("data/knowledge-ja/color-source.pdf", "reference/mlit-color-source.pdf", colors.source.sha256);
await asset("data/knowledge-ja/lessons.json", "reference/source-audit.json", bundle.datasetSha256);
for (const name of ["upload", "rotate-ccw", "search", "x", "chevron-down"])
  await asset(`node_modules/lucide-static/icons/${name}.svg`, `assets/icons/${name}.svg`);
await asset("node_modules/lucide-static/LICENSE", "assets/icons/LICENSE");
await cp(path.join(root, "src/assets/fonts"), path.join(output, "assets/fonts"), { recursive: true });
for (const image of bundle.images) {
  await asset(`data/${image.original.sourcePath}`, image.original.path, image.original.sha256);
  if (image.verifiedColor) await asset(`data/${image.verifiedColor.sourcePath}`, image.verifiedColor.path, image.verifiedColor.sha256);
}
for (const article of bundle.articles) for (const block of article.blocks) for (const image of block.facsimiles || [])
  await asset(`data/${image.sourcePath}`, image.path, image.sourcePath.split("/").at(-1).replace(".png", ""));
const unitsById = new Map(bundle.units.map((unit) => [unit.id, unit]));
const imagesById = new Map(bundle.images.map((image) => [image.id, image]));
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function text(entry) { return entry.unitId ? unitsById.get(entry.unitId).sourceText : entry.literal; }
function markdown(article) {
  const lines = [`# ${unitsById.get(article.titleUnit).sourceText}`, "", `Article: ${article.id}`, `PDF pages: ${article.source.pages.join(", ")}`, ""];
  for (const block of article.blocks) {
    if (block.kind === "text") {
      if (block.unitId) lines.push(`<!-- unit: ${block.unitId}; hash: ${unitsById.get(block.unitId).sourceHash} -->`);
      lines.push(`${block.tag === "h2" ? "## " : block.tag === "h3" ? "### " : ""}${text(block)}`, "");
    } else if (block.kind === "figure") {
      lines.push(`![${block.imageId}](../${imagesById.get(block.imageId).original.path})`, "");
    } else {
      lines.push(`<!-- table: ${block.id}; source pages: ${block.sourcePages.join(",")}; zero-based rows/columns -->`, "<table><tbody>");
      for (let row = 0; row < block.rows; row += 1) {
        lines.push("<tr>");
        for (const cell of block.cells.filter((cell) => cell.row === row)) {
          lines.push(`<td rowspan="${cell.rowspan}" colspan="${cell.colspan}"><!-- cell: ${cell.id}; row: ${cell.row}; column: ${cell.column}; reference: ${cell.reference || "none"} -->`);
          for (const entry of cell.content) {
            if (entry.kind === "text") lines.push(`${entry.unitId ? `<!-- unit: ${entry.unitId} -->` : ""}<p>${escape(text(entry))}</p>`);
            else lines.push(`<img src="../${imagesById.get(entry.imageId).original.path}" alt="${escape(entry.imageId)}" />`);
          }
          lines.push("</td>");
        }
        lines.push("</tr>");
      }
      lines.push("</tbody></table>", "");
    }
  }
  return lines.join("\n");
}
const batches = [];
for (const [index, article] of bundle.articles.entries()) {
  const key = `${String(index + 1).padStart(3, "0")}-${article.id}`;
  const units = articleUnits(bundle, article);
  const batch = { version: 1, packageId: bundle.packageId, targetLocale: locale, source: bundle.source,
    article, units, images: bundle.images.filter((image) => image.articleId === article.id) };
  await json(`lessons/${key}.source.json`, batch);
  await writeFile(path.join(output, "lessons", `${key}.source.md`), markdown(article), "utf8");
  await json(`return-templates/${key}.${locale}.json`, translationTemplate(bundle, units));
  batches.push({ articleId: article.id, groupId: article.group.id, units: units.length,
    source: `lessons/${key}.source.json`, readable: `lessons/${key}.source.md`, result: `return-templates/${key}.${locale}.json` });
}
await json("bundle.json", bundle);
const bundleBytes = await readFile(path.join(output, "bundle.json"));
inventory.push({ path: "bundle.json", sha256: hash(bundleBytes), bytes: bundleBytes.length });
await json("batch-index.json", { version: 1, packageId: bundle.packageId, targetLocale: locale, batches });
await json("pilot-index.json", { packageId: bundle.packageId,
  batches: batches.filter((batch) => ["ja-kyousoku-chapter-01-section-01", "ja-kyousoku-appendix-3-part-5"].includes(batch.articleId)) });
await json("images-manifest.json", { version: 1, packageId: bundle.packageId, source: bundle.source, colorSource: bundle.colorSource, images: bundle.images });
await json("return-templates/image-plan.json", imagePlanTemplate(bundle));
await json("return-templates/glossary.json", { version: 1, packageId: bundle.packageId, targetLocale: locale, terms: [] });
await json("asset-integrity.json", { version: 1, packageId: bundle.packageId, files: inventory });
await writeFile(path.join(output, "bundle.js"), `window.MENKYO_HANDOFF=${JSON.stringify(bundle).replace(/</g, "\\u003c")};\n`, "utf8");
await cp(path.join(root, "scripts/knowledge-review"), output, { recursive: true });
await copyFile(path.join(root, "docs/knowledge-ai-prompt.md"), path.join(output, "PROMPT-CHO-MUSE.md"));
await copyFile(path.join(root, "docs/knowledge-ai-handoff.md"), path.join(output, "BAT-DAU-O-DAY.md"));
console.log(JSON.stringify({ output, packageId: bundle.packageId, targetLocale: locale, ...bundle.counts, copiedAssets: inventory.length }, null, 2));
