import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { localizeKnowledge } from "./knowledge-localization.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const input = path.resolve(process.argv[2] || path.join(root, "output/incoming/mirai-menkyo-locale-package"));
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const sourceBytes = await readFile(path.join(root, "data/knowledge-ja/lessons.json"));
const source = JSON.parse(sourceBytes.toString("utf8"));
const incoming = await load(path.join(input, "data/knowledge-ja/lessons.json"));
const strip = (data) => JSON.parse(JSON.stringify(data, (key, value) => key === "colorPath" ? undefined : value));
assert.deepEqual(strip(incoming), source, "Package changed Japanese source or table layout");
const translation = await load(path.join(input, "data/knowledge-vi/lessons-vi.json"));
assert.deepEqual(Object.keys(translation.articles).sort(), source.articles.map((article) => article.id).sort());
for (const article of source.articles) {
  const valid = new Map([[`${article.id}/title`, article.title]]);
  for (const block of article.blocks) {
    if (block.kind === "text") valid.set(block.id, block.text);
    for (const cell of block.cells || []) valid.set(`${article.id}/${cell.id}`, cell.paragraphs.map((p) => p.text).join(""));
  }
  for (const [id, text] of Object.entries(translation.articles[article.id].units)) {
    assert.ok(valid.has(id), `Unknown source unit: ${id}`);
    assert.equal(typeof text, "string");
    assert.ok(!valid.get(id).trim() || text.trim(), `Empty translation: ${id}`);
    assert.ok(!/<\/?(?:script|iframe|img|style)\b/i.test(text));
  }
}
const overrides = await load(path.join(root, "data/knowledge-vi/editorial-overrides.json"));
assert.equal(localizeKnowledge(source, translation, overrides).length, 71);
translation.sourceSha256 = source.source.sha256;
translation.sourceDatasetSha256 = hash(sourceBytes);
translation.origin = "user-supplied-ai-translation";
await writeFile(path.join(root, "data/knowledge-vi/lessons-vi.json"), JSON.stringify(translation, null, 2) + "\n", "utf8");

const pack = await load(path.join(input, "data/knowledge-ja/color-applied-manifest.json"));
const corrected = await load(path.join(root, "output/incoming/reviewed-colors/manifest.json"));
const repairs = new Map(corrected.map((image) => [image.imageId, image]));
const originals = new Map(source.articles.flatMap((article) => article.blocks.flatMap((block) => block.kind === "figure" ? [block.image] : (block.cells || []).flatMap((cell) => cell.images))).map((image) => [image.id, image]));
const destination = path.join(root, "data/knowledge-ja/colors");
await mkdir(destination, { recursive: true });
const images = [], seen = new Set();
for (const item of pack.images) {
  assert.ok(!seen.has(item.imageId), `Duplicate image: ${item.imageId}`); seen.add(item.imageId);
  assert.equal(item.originalSha256, path.basename(originals.get(item.imageId)?.path || "", ".png"));
  // The clover in the PDF is a dimensioned drawing, not only the bare symbol.
  if (item.imageId === "p141-image03") continue;
  const repair = repairs.get(item.imageId);
  const chosen = repair || item;
  assert.match(chosen.sha256, /^[a-f0-9]{64}$/);
  assert.equal(chosen.path, `knowledge-ja/colors/${chosen.sha256}.png`);
  const file = repair ? path.join(root, "output/incoming/reviewed-colors", `${chosen.sha256}.png`) : path.join(input, "data", item.path);
  const bytes = await readFile(file);
  assert.equal(hash(bytes), chosen.sha256);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [chosen.width, chosen.height]);
  let sourceUrl = repair?.sourceUrl;
  if (!sourceUrl && /^https:\/\/commons\.wikimedia\.org\//.test(item.source)) sourceUrl = item.source.replace("/wiki/Special:FilePath/", "/wiki/File:");
  if (!sourceUrl && item.source.startsWith("Wikimedia Commons")) sourceUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(item.source.replace(/^Wikimedia Commons:?\s*/, "").replace(/ \(no-arrow variant\)$/, ""))}`;
  if (!sourceUrl) sourceUrl = "https://www.mlit.go.jp/road/sign/sign/douro/ichiran.pdf";
  await copyFile(file, path.join(destination, `${chosen.sha256}.png`));
  images.push({ imageId: item.imageId, originalSha256: item.originalSha256, path: chosen.path, sha256: chosen.sha256,
    width: chosen.width, height: chosen.height, sourceUrl,
    rightsUrl: repair?.rightsUrl || (sourceUrl.includes("commons.wikimedia.org") ? sourceUrl : "https://www.mlit.go.jp/road/soudan/soudan_04a_04.html"),
    review: repair ? "re-extracted-from-pinned-official-poster" : "package-compared-with-original", ...(repair ? { crop: repair.crop } : {}) });
}
await writeFile(path.join(root, "data/knowledge-ja/color-applied-manifest.json"), JSON.stringify({ version: 1,
  source: { url: "https://www.mlit.go.jp/road/sign/sign/douro/ichiran.pdf", sha256: "ea44489d2449ec7577efe8d31f8f939db79184602078695936d4664408d81853" },
  images, rejected: [{ imageId: "p141-image03", reason: "Replacement removes original dimension labels; original retained" }] }, null, 2) + "\n", "utf8");
console.log(`Imported ${Object.keys(translation.articles).length} translated articles; ${images.length} reference images, ${corrected.length} repaired crops; original Japanese source untouched.`);
