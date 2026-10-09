import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { localizeKnowledge } from "./knowledge-localization.mjs";
import { dataConfig } from "../dist/data-config.js";
import { readBuiltData } from "./data-files.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const load = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = await load("data/knowledge-ja/lessons.json");
const translation = await load("data/knowledge-vi/lessons-vi.json");
const editorial = await load("data/knowledge-vi/editorial-overrides.json");
const manifest = await readBuiltData(path.join(root, "dist", dataConfig.manifestPath), dataConfig);
const knowledge = await readBuiltData(path.join(root, "dist", manifest.knowledgePath), dataConfig);
const localized = knowledge.filter((article) => article.locale === "vi" && article.format === "pdf-lessons-v1");
assert.equal(localized.length, 71);
assert.equal(manifest.knowledgeDefaultLocale, "vi");
assert.equal(manifest.knowledgeFallbackLocale, "ja");
assert.equal(translation.sourceDatasetSha256, hash(await readFile(path.join(root, "data/knowledge-ja/lessons.json"))));
const unchanged = JSON.stringify(source);
const regenerated = localizeKnowledge(source, translation, editorial);
assert.equal(JSON.stringify(source), unchanged, "Translation mutated the Japanese source");
let bodyUnits = 0, cellUnits = 0, images = 0;
for (const [index, original] of source.articles.entries()) {
  const result = localized[index], input = translation.articles[original.id];
  const outputById = new Map(result.blocks.map((block) => [block.id, block]));
  const mergedSourceIds = new Set(Object.values(editorial.blockMerges || {}).flatMap((merge) => merge.sources || []));
  assert.equal(result.sourceArticleId, original.id);
  assert.equal(result.id, original.id.replace(/^ja-/, "vi-"));
  assert.equal(result.title, input.title_vi);
  assert.equal(result.text, regenerated[index].text);
  for (const block of original.blocks) {
    const output = outputById.get(block.id);
    if (mergedSourceIds.has(block.id)) {
      assert.equal(output, undefined, `Merged continuation still present: ${block.id}`);
      continue;
    }
    assert.ok(output, `Missing output block: ${block.id}`);
    assert.equal(output.id, block.id);
    if (block.kind === "text" && block.text.trim()) {
      let expected = input.units[block.id];
      const correction = editorial.textReplacements[block.id];
      if (correction) expected = expected.replace(correction.from, correction.to);
      const merge = editorial.blockMerges?.[block.id];
      if (merge) expected = merge.text;
      if (block.tag === "h2" && block.text.trim() === original.title.trim()) expected = result.title;
      assert.equal(output.text, expected, `Wrong body unit: ${block.id}`);
      assert.equal(output.tag, merge?.tag || editorial.blockTags?.[block.id] || block.tag, `Wrong body tag: ${block.id}`);
      assert.equal(output.runs.length, 1);
      bodyUnits += 1;
    }
    for (const [cellIndex, cell] of (block.cells || []).entries()) {
      const target = output.cells[cellIndex];
      assert.deepEqual([target.id, target.row, target.column, target.rowspan, target.colspan, target.reference], [cell.id, cell.row, cell.column, cell.rowspan, cell.colspan, cell.reference]);
      const expectedImages = cell.content.filter((entry) => entry.kind === "image").map((entry) => cell.images[entry.index].id);
      const actualImages = target.content.filter((entry) => entry.kind === "image").map((entry) => target.images[entry.index].id);
      assert.deepEqual(actualImages, expectedImages, `Wrong image/caption association: ${cell.id}`);
      images += actualImages.length;
      const parts = target.content.filter((entry) => entry.kind === "text").map((entry) => target.paragraphs[entry.index].text);
      if (editorial.cellParagraphs[cell.id]) assert.deepEqual(parts, Object.values(editorial.cellParagraphs[cell.id]));
      else if (cell.paragraphs.some((p) => p.text.trim())) {
        assert.deepEqual(parts, [input.units[`${original.id}/${cell.id}`]], `Repeated cell translation: ${cell.id}`);
        cellUnits += 1;
      }
    }
  }
}
const active = await load("data/knowledge-ja/color-applied-manifest.json");
assert.equal(active.images.length, 151);
assert.ok(!active.images.some((image) => image.imageId === "p141-image03"));
assert.deepEqual(active.images.find((image) => image.imageId === "p119-image01").crop, [741.3, 291.6, 787.6, 309]);
for (const image of active.images) assert.equal(hash(await readFile(path.join(root, "data", image.path))), image.sha256);
assert.ok(!localized.find((article) => article.id === "vi-kyousoku-chapter-03-section-03").text.includes("途切れ"));
assert.equal(knowledge.filter((article) => article.locale === "ja").length, 71);
const legacy = await load("data/karimen-honmen-vi/all.json");
const currentLaw = await load("data/knowledge-vi/current-law-updates.json");
const quickReview = await load("data/knowledge-vi/quick-review.json");
assert.equal(knowledge.filter((article) => article.locale === "vi" && article.format !== "pdf-lessons-v1").length, quickReview.articles.length + currentLaw.articles.length);
assert.ok(!knowledge.some((article) => article.id.startsWith("vi-knowledge-")), "Legacy Vietnamese articles must not be published");
assert.equal(knowledge.filter((article) => article.currentLaw).length, currentLaw.articles.length);
console.log(`Verified 71 complete Vietnamese articles: ${bodyUnits} body units, ${cellUnits} aggregate cells without repetition, 8 interleaved-caption mappings, ${images} cell images, unchanged Japanese source, 151 hashed references and protected original dimension diagram.`);
