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
const pixelInputs = [];
const mime = { ".gif": "image/gif", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
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
    assert.equal(result.quality?.alpha_max_error, 0, "Missing alpha/content validation");
    pixelInputs.push({
      name: `${item.references[0]}/${scale}x`,
      source: `data:${mime[path.extname(item.path).toLowerCase()]};base64,${source.toString("base64")}`,
      target: `data:image/png;base64,${bytes.toString("base64")}`,
    });
  }
}
const browser = await chromium.launch();
try {
  const analysisPage = await browser.newPage();
  const pixelChecks = await analysisPage.evaluate(async (inputs) => {
    function pixels(image, white) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (white) {
        context.fillStyle = "white";
        context.fillRect(0, 0, 128, 128);
      }
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, 128, 128);
      return context.getImageData(0, 0, 128, 128).data;
    }
    function errors(left, right, alpha) {
      const totals = Array(64).fill(0);
      const channels = alpha ? [3] : [0, 1, 2];
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const tile = Math.floor(y / 16) * 8 + Math.floor(x / 16);
          const offset = (y * 128 + x) * 4;
          for (const channel of channels) totals[tile] += Math.abs(left[offset + channel] - right[offset + channel]);
        }
      }
      const means = totals.map((sum) => sum / (256 * channels.length));
      return { mean: means.reduce((sum, value) => sum + value, 0) / 64, maximum: Math.max(...means) };
    }
    const checks = [];
    for (const input of inputs) {
      // Data URLs allow pixel inspection without file:// canvas security issues.
      const source = new Image();
      const target = new Image();
      source.src = input.source;
      target.src = input.target;
      await source.decode();
      await target.decode();
      checks.push({ name: input.name, rgb: errors(pixels(source, true), pixels(target, true), false), alpha: errors(pixels(source, false), pixels(target, false), true) });
    }
    return checks;
  }, pixelInputs);
  for (const check of pixelChecks) {
    assert.ok(check.rgb.mean <= 20 && check.rgb.maximum <= 45, `${check.name}: color/content lost in a region (${JSON.stringify(check.rgb)})`);
    assert.ok(check.alpha.mean <= 10 && check.alpha.maximum <= 20, `${check.name}: content made transparent (${JSON.stringify(check.alpha)})`);
  }
  await analysisPage.close();
  console.log(`OK: ${pixelChecks.length} outputs checked for visible content and opacity on an 8x8 region grid`);
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
    if (width === 1440) {
      const rows = page.locator("section");
      for (let index = 0; index < report.images.length; index++) {
        await rows.nth(index).screenshot({ path: path.join(output, `row-${report.images[index].references[0]}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`OK: ${width}px preview, all images loaded and contained`);
  }
} finally {
  await browser.close();
}
console.log(`Passed: ${report.images.length} unique sources unchanged, correct dimensions and hashes.`);
