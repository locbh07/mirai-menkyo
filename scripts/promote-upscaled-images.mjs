import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const batch = path.resolve(root, process.argv[2] || "output/upscale-batch");
const destination = path.join(root, "data/enhanced-exam-images");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(path.join(batch, "manifest.json"));
const report = JSON.parse(manifestBytes.toString("utf8"));
const validation = JSON.parse(await readFile(path.join(batch, "validation.json"), "utf8"));
assert.equal(report.completed, true, "Batch is incomplete");
assert.deepEqual(report.scales, [4], "Promotion requires a 4x batch");
assert.equal(report.settings.pipeline_version, 2, "Only the RGB/separate-alpha pipeline is accepted");
assert.equal(validation.verified, true);
assert.equal(validation.manifestSha256, sha256(manifestBytes), "Batch has changed since validation");
assert.equal(validation.checkerSha256, sha256(await readFile(path.join(root, "scripts/check-upscale-preview.mjs"))), "Run the current preview checker first");
assert.equal(validation.verifiedOutputs, report.images.length);
assert.equal(report.selected_images, report.images.length + report.rejected.length);
assert.ok(report.images.length > 0);

// Validate everything before writing the production pack; originals stay untouched.
const images = [];
const files = new Map();
for (const item of report.images) {
  const result = item.outputs["4"];
  assert.match(item.sha256, /^[a-f0-9]{64}$/);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  const sourceRoot = path.join(root, "data/karimen-honmen-vi");
  const sourceFile = path.resolve(sourceRoot, item.path);
  assert.ok(sourceFile.startsWith(sourceRoot + path.sep), "Invalid source path");
  const source = await readFile(sourceFile);
  assert.equal(sha256(source), item.sha256, "Source changed since batch processing");
  const file = path.resolve(batch, result.path);
  assert.ok(file.startsWith(batch + path.sep), "Invalid output path");
  const bytes = await readFile(file);
  assert.equal(sha256(bytes), result.sha256, "Output changed since validation");
  assert.equal(result.quality.alpha_max_error, 0);
  assert.ok(result.quality.visible_mae <= 20 && result.quality.max_tile_mae <= 45);
  assert.equal(bytes.readUInt32BE(16), item.size[0] * 4);
  assert.equal(bytes.readUInt32BE(20), item.size[1] * 4);
  const filename = `${result.sha256}.png`;
  files.set(filename, bytes);
  images.push({ sourceSha256: item.sha256, outputSha256: result.sha256, file: filename,
    originalSize: item.size, size: result.size });
}
await mkdir(destination, { recursive: true });
for (const [filename, bytes] of files) await writeFile(path.join(destination, filename), bytes);
await writeFile(path.join(destination, "manifest.json"), JSON.stringify({
  version: 1, scale: 4, pipelineVersion: 2, generatedAt: new Date().toISOString(),
  batchSha256: validation.manifestSha256, images,
}, null, 2), "utf8");
console.log(`Promoted ${images.length} sources as ${files.size} content-addressed PNGs; originals unchanged.`);
