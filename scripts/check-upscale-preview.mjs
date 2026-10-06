import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.resolve(root, process.argv[2] || "output/upscale-preview");
const report = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
assert.ok(report.images.length > 0);
const hashes = new Set();
for (const item of report.images) {
  assert.equal(hashes.has(item.sha256), false, "Duplicate image was processed twice");
  hashes.add(item.sha256);
  const source = await readFile(path.join(root, "data/karimen-honmen-vi", item.path));
  assert.equal(createHash("sha256").update(source).digest("hex"), item.sha256, "Source file changed");
  for (const scale of report.scales) {
    const result = item.outputs[String(scale)];
    assert.deepEqual(result.size, item.size.map((edge) => edge * scale));
    const bytes = await readFile(path.join(output, result.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), result.sha256);
  }
}
const browser = await chromium.launch();
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(output, "index.html")).href);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
    assert.equal(await page.locator("section").count(), report.images.length);
    assert.equal(await page.locator("img").count(), report.images.length * (report.scales.length + 1));
    const problems = await page.evaluate(() => {
      const errors = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) errors.push("Horizontal overflow");
      for (const img of document.images) {
        const rect = img.getBoundingClientRect();
        const canvas = img.parentElement.getBoundingClientRect();
        const figure = img.closest("figure").getBoundingClientRect();
        if (rect.top < canvas.top - 1 || rect.bottom > canvas.bottom + 1 || rect.left < canvas.left - 1 || rect.right > canvas.right + 1) errors.push("Image escapes canvas");
        if (canvas.bottom > figure.bottom + 1) errors.push("Canvas overlaps following content");
        if (getComputedStyle(img).objectFit !== "contain") errors.push("Image may be cropped");
      }
      return errors;
    });
    assert.deepEqual(problems, [], `${width}px comparison layout`);
    await page.screenshot({ path: path.join(output, `comparison-${width}.png`) });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`OK: ${width}px preview, all images loaded and contained`);
  }
} finally {
  await browser.close();
}
console.log(`Passed: ${report.images.length} unique sources unchanged, correct dimensions and hashes.`);
