import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.resolve(root, process.argv[2] || "output/upscale-preview");
const manifestBytes = await readFile(path.join(output, "manifest.json"));
const report = JSON.parse(manifestBytes.toString("utf8"));
assert.ok(report.images.length > 0);
if (report.selected_images !== undefined) {
  assert.equal(report.completed, true, "Batch is not complete");
  assert.equal(report.images.length + (report.rejected?.length || 0), report.selected_images);
}
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
      sourcePath: path.join(root, "data/karimen-honmen-vi", item.path),
      targetPath: path.join(output, result.path),
    });
  }
}
async function inspectPixels(inputs) {
    function pixels(image, white, width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (white) {
        context.fillStyle = "white";
        context.fillRect(0, 0, width, height);
      }
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    }
    function errors(left, right, alpha, width, height) {
      const grid = Math.min(8, width, height);
      const totals = Array(grid * grid).fill(0);
      const samples = Array(grid * grid).fill(0);
      const channels = alpha ? [3] : [0, 1, 2];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = Math.floor(y * grid / height) * grid + Math.floor(x * grid / width);
          const offset = (y * width + x) * 4;
          for (const channel of channels) totals[tile] += Math.abs(left[offset + channel] - right[offset + channel]);
          samples[tile] += channels.length;
        }
      }
      const means = totals.map((sum, index) => sum / samples[index]);
      return { mean: totals.reduce((sum, value) => sum + value, 0) / samples.reduce((sum, value) => sum + value, 0), maximum: Math.max(...means) };
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
      // Never enlarge the reference during validation; that measures interpolation.
      const factor = Math.min(1, 128 / Math.max(source.naturalWidth, source.naturalHeight));
      const width = Math.max(1, Math.round(source.naturalWidth * factor));
      const height = Math.max(1, Math.round(source.naturalHeight * factor));
      checks.push({ name: input.name, rgb: errors(pixels(source, true, width, height), pixels(target, true, width, height), false, width, height), alpha: errors(pixels(source, false, width, height), pixels(target, false, width, height), true, width, height) });
    }
    return checks;
}
const browser = await chromium.launch();
try {
  const analysisPage = await browser.newPage();
  const pixelChecks = [];
  for (let offset = 0; offset < pixelInputs.length; offset += 16) {
    const inputs = [];
    for (const item of pixelInputs.slice(offset, offset + 16)) {
      const source = await readFile(item.sourcePath);
      const target = await readFile(item.targetPath);
      inputs.push({ name: item.name, source: `data:${mime[path.extname(item.sourcePath).toLowerCase()]};base64,${source.toString("base64")}`, target: `data:image/png;base64,${target.toString("base64")}` });
    }
    const checks = await analysisPage.evaluate(inspectPixels, inputs);
    pixelChecks.push(...checks);
  }
  const failures = pixelChecks.filter((check) => check.rgb.mean > 20 || check.rgb.maximum > 45 || check.alpha.mean > 10 || check.alpha.maximum > 20);
  await writeFile(path.join(output, "browser-review.json"), JSON.stringify({ checked: pixelChecks.length, failures, checks: pixelChecks }, null, 2), "utf8");
  assert.equal(failures.length, 0, `Outputs held for review: ${JSON.stringify(failures)}`);
  await analysisPage.close();
  console.log(`OK: ${pixelInputs.length} outputs checked for visible content and opacity on an 8x8 region grid`);
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
await writeFile(path.join(output, "validation.json"), JSON.stringify({
  verified: true, verifiedAt: new Date().toISOString(),
  manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  checkerSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
  acceptedImages: report.images.length, verifiedOutputs: pixelInputs.length,
  pixelGrid: 8, viewports: [390, 1440],
}, null, 2), "utf8");
