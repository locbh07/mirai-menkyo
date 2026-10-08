import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { chromium } from "playwright";
import { createHandoff, articleUnits, translationTemplate, imagePlanTemplate, validateTranslations, validateImagePlan, hash } from "./knowledge-handoff.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bytes = await readFile(path.join(root, "data/knowledge-ja/lessons.json"));
const source = JSON.parse(bytes.toString("utf8"));
const colors = JSON.parse(await readFile(path.join(root, "data/knowledge-ja/color-applied-manifest.json"), "utf8"));
const bundle = createHandoff(source, colors, "vi", hash(bytes));
assert.equal(bundle.counts.articles, 71);
assert.equal(bundle.counts.images, 277);
assert.equal(bundle.counts.colorImages, colors.images.length);
assert.equal(bundle.counts.tables, 34);
assert.equal(bundle.counts.sourceTableFragments, 87);
assert.equal(bundle.packageId, createHandoff(source, colors, "vi", hash(bytes)).packageId);
assert.notEqual(bundle.packageId, createHandoff(source, colors, "en", hash(bytes)).packageId);
const unitMap = new Map(bundle.units.map((unit) => [unit.id, unit]));
for (const [index, article] of source.articles.entries()) {
  const layout = bundle.articles[index];
  assert.equal(layout.id, article.id);
  for (const [index, block] of article.blocks.entries()) {
    const view = layout.blocks[index];
    assert.equal(view.kind, block.kind);
    if (block.kind === "text") assert.equal(view.unitId ? unitMap.get(view.unitId).sourceText : view.literal, block.text);
    if (block.kind === "table") {
      assert.deepEqual([view.rows, view.columns, view.hasHeader, view.layout], [block.rows, block.columns, block.hasHeader, block.layout]);
      for (const [index, cell] of block.cells.entries()) {
        const output = view.cells[index];
        assert.deepEqual([output.id, output.row, output.column, output.rowspan, output.colspan, output.reference], [cell.id, cell.row, cell.column, cell.rowspan, cell.colspan, cell.reference || null]);
        assert.deepEqual(output.content.map((entry) => entry.kind === "image" ? entry.imageId : entry.unitId ? unitMap.get(entry.unitId).sourceText : entry.literal), cell.content.map((entry) => entry.kind === "image" ? cell.images[entry.index].id : cell.paragraphs[entry.index].text));
      }
    }
  }
}
const template = translationTemplate(bundle);
assert.equal(validateTranslations(bundle, [template]).valid, true);
assert.equal(validateTranslations(bundle, [template], { complete: true }).valid, false);
const filled = structuredClone(template);
for (const entry of filled.translations) { entry.translation = unitMap.get(entry.unitId).sourceText.trim(); entry.status = "translated"; }
assert.equal(validateTranslations(bundle, [filled], { complete: true }).valid, true);
for (const change of [
  (file) => { file.targetLocale = "en"; },
  (file) => { file.packageId = "bad"; },
  (file) => { file.translations[0].sourceHash = "bad"; },
  (file) => { file.translations.push(file.translations[0]); },
  (file) => { file.translations[0].unitId = "unknown"; },
  (file) => { file.translations[0].status = "approved"; },
  (file) => { file.translations[0].translation = ""; },
  (file) => { file.translations[0].translation = 123; },
  (file) => { file.translations[0].translation = "<script>alert(1)</script>"; },
  (file) => { file.translations[0].status = "needs_review"; file.translations[0].notes = []; },
]) {
  const bad = structuredClone(filled); change(bad);
  assert.equal(validateTranslations(bundle, [bad], { complete: true }).valid, false);
}
const numeric = bundle.units.find((unit) => unit.protectedNumbers.length);
const altered = translationTemplate(bundle, [numeric]);
altered.translations[0] = { ...altered.translations[0], translation: "999999", status: "translated" };
assert.ok(validateTranslations(bundle, [altered]).warnings.some((warning) => warning.reason === "numbers_changed"));
const duplicate = bundle.units.find((unit) => unit.duplicateOf);
const wrongHeading = translationTemplate(bundle, [duplicate, unitMap.get(duplicate.duplicateOf)]);
wrongHeading.translations.forEach((entry, index) => { entry.translation = `Different ${index}`; entry.status = "translated"; });
assert.equal(validateTranslations(bundle, [wrongHeading]).valid, false);
const conflicting = structuredClone(filled); conflicting.translations[0].translation = "Different";
assert.equal(validateTranslations(bundle, [filled, conflicting]).valid, false);
assert.equal(validateTranslations(bundle, [filled, filled]).valid, true);
const plan = imagePlanTemplate(bundle);
assert.equal(validateImagePlan(bundle, plan).valid, true);
const badPlan = structuredClone(plan); badPlan.images.pop();
assert.equal(validateImagePlan(bundle, badPlan).valid, false);
const unverified = structuredClone(plan); unverified.images.find((item) => item.decision === "keep_original").decision = "reuse_verified_color";
assert.equal(validateImagePlan(bundle, unverified).valid, false);
const badPath = structuredClone(plan);
Object.assign(badPath.images[0], { decision: "propose_replacement", proposedFile: "../source.pdf", proposedSha256: "bad", sourceUrl: "javascript:alert(1)", rightsUrl: null });
assert.equal(validateImagePlan(bundle, badPath).valid, false);
console.log(`Contract: ${bundle.counts.units} immutable units, 71 layouts, 277 images; exact captions/cell spans, stale/wrong/duplicate/partial/conflicting results, numbers, headings and unsafe image proposals tested`);

const exported = JSON.parse(execFileSync(process.execPath, ["scripts/export-knowledge-handoff.mjs", "--locale", "vi"], { cwd: root, encoding: "utf8" }));
const directory = exported.output;
const inventory = JSON.parse(await readFile(path.join(directory, "asset-integrity.json"), "utf8"));
for (const file of inventory.files) assert.equal(hash(await readFile(path.join(directory, file.path))), file.sha256);
const pilot = bundle.articles.find((article) => article.id === "ja-kyousoku-chapter-01-section-01");
const returned = translationTemplate(bundle, articleUnits(bundle, pilot));
const title = returned.translations.find((entry) => entry.unitId === pilot.titleUnit);
title.translation = "Bài thử VI <img src=x onerror=alert(1)>"; title.status = "translated";
const testResult = path.join(directory, "test-returned.json");
await writeFile(testResult, JSON.stringify(returned), "utf8");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff": "font/woff" };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(directory, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(directory + path.sep)) throw new Error("Path outside package");
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const shots = path.join(root, "output/translation-handoff-check");
await mkdir(shots, { recursive: true });
let browser;
const errors = [];
try {
  browser = await chromium.launch();
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.locator("#lesson option").count(), 71);
    await page.locator("#lesson").selectOption(pilot.id);
    await page.locator("#files").setInputFiles(testResult);
    await page.waitForFunction(() => document.querySelector("#target h1").textContent.startsWith("Bài thử VI"));
    assert.equal(await page.locator("#target h1 img").count(), 0, "Returned text was executed as markup");
    await page.locator("#reset").click();
    await page.locator("#lesson").selectOption("ja-kyousoku-appendix-3-part-1");
    assert.equal(await page.locator("#source td").count(), await page.locator("#target td").count());
    await page.locator("[data-image-id]").evaluateAll((images) => images.forEach((image) => { image.loading = "eager"; }));
    await page.waitForFunction(() => [...document.querySelectorAll("[data-image-id]")].every((image) => image.complete && image.naturalWidth));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll("button,select,input[type=search]")].filter((element) => element.getClientRects().length).every((element) => element.getBoundingClientRect().height >= 44)), true);
    await page.locator("#colors").uncheck();
    await page.waitForFunction(() => [...document.querySelectorAll("[data-image-id]")].every((image) => image.complete && image.naturalWidth));
    assert.ok((await page.locator("[data-image-id]").first().getAttribute("src")).startsWith("media/original/"));
    await page.locator("#colors").check();
    await page.locator("#source [data-image]").first().click();
    await page.waitForSelector("#viewer[open]");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#viewer").getAttribute("open"), null);
    await page.screenshot({ path: path.join(shots, `${width}-review.png`) });
    const loaded = new Set();
    for (const article of bundle.articles) {
      await page.locator("#lesson").selectOption(article.id);
      const text = await page.locator("#source > [data-unit]").allTextContents();
      const expectedText = article.blocks.filter((block) => block.kind === "text" && unitMap.get(block.unitId)?.duplicateOf !== article.titleUnit).map((block) => block.unitId ? unitMap.get(block.unitId).sourceText : block.literal);
      assert.deepEqual(text, expectedText, `${article.id}: source body changed`);
      const actual = await page.locator("#source .table-scroll th,#source .table-scroll td").evaluateAll((cells) => cells.map((cell) => ({
        rowspan: cell.rowSpan, colspan: cell.colSpan,
        content: [...cell.children].filter((node) => node.matches("[data-unit],.image")).map((node) => node.matches(".image") ? node.dataset.image : node.textContent),
      })));
      const expectedCells = article.blocks.filter((block) => block.kind === "table").flatMap((block) => block.cells.map((cell) => ({
        rowspan: cell.rowspan, colspan: cell.colspan,
        content: cell.content.map((entry) => entry.kind === "image" ? entry.imageId : entry.unitId ? unitMap.get(entry.unitId).sourceText : entry.literal),
      })));
      assert.deepEqual(actual, expectedCells, `${article.id}: source grid/caption order changed`);
      await page.locator("[data-image-id]").evaluateAll((images) => images.forEach((image) => { image.loading = "eager"; }));
      await page.waitForFunction(() => [...document.querySelectorAll("[data-image-id]")].every((image) => image.complete && image.naturalWidth));
      const imageCheck = await page.locator("#source [data-image-id]").evaluateAll((images) => images.map((image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
        const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let nonblank = false;
        for (let i = 0; i < bytes.length; i += 4) if (Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) < 220 && bytes[i + 3] > 0) { nonblank = true; break; }
        return { id: image.dataset.imageId, nonblank };
      }));
      assert.ok(imageCheck.every((image) => image.nonblank), `${article.id}: blank preview image`);
      imageCheck.forEach((image) => loaded.add(image.id));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${article.id}: outer overflow`);
    }
    assert.equal(loaded.size, 277);
    await page.close();
    console.log(`Preview ${width}px: all 71 lessons and 277 nonblank images, exact source grids/caption order, JSON import/reset, markup escaping, modes, dialog, touch targets and no outer overflow`);
  }
  const offline = await browser.newPage();
  await offline.goto(pathToFileURL(path.join(directory, "index.html")).href);
  assert.equal(await offline.locator("#lesson option").count(), 71);
  await offline.locator("#lesson").selectOption("ja-kyousoku-appendix-3-part-5");
  await offline.locator("[data-image-id]").evaluateAll((images) => images.forEach((image) => { image.loading = "eager"; }));
  await offline.waitForFunction(() => [...document.querySelectorAll("[data-image-id]")].every((image) => image.complete && image.naturalWidth));
  await offline.close();
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
console.log(`Passed handoff contract/assets, offline-file preview and desktop/mobile checks. Test package: ${directory}`);
