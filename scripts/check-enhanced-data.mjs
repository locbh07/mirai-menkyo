import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceRoot = path.join(root, "data/karimen-honmen-vi");
const originals = JSON.parse(await readFile(path.join(sourceRoot, "all.json"), "utf8"));
const packBytes = await readFile(path.join(root, "data/enhanced-exam-images/manifest.json"));
const pack = JSON.parse(packBytes.toString("utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "dist/data/manifest.json"), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalMode = process.env.MENKYO_ORIGINAL_IMAGES === "1";
assert.equal(manifest.imageVersion, originalMode ? null : sha256(JSON.stringify(pack)).slice(0, 12));
const byHash = new Map(pack.images.map((item) => [item.sourceSha256, item]));
const expectedPaths = new Map();
let questions = 0, upgraded = 0, fallback = 0;
for (const exam of originals.exam_sets) {
  const entry = manifest.exams.find((item) => item.id === exam.source_id);
  assert.ok(entry);
  const bytes = await readFile(path.join(root, "dist", entry.path));
  const actual = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(await readFile(path.join(root, "dist/data/exams", exam.exam_type, `exam-${exam.exam_number}.json`)), bytes);
  assert.equal(actual.questions.length, exam.questions.length);
  for (let index = 0; index < exam.questions.length; index++) {
    const before = exam.questions[index], after = actual.questions[index];
    assert.equal(after.id, before.source_id);
    assert.equal(after.number, before.question_number);
    assert.equal(after.correct, before.correct);
    assert.deepEqual(after.textAll, before.text || {});
    assert.deepEqual(after.explanationAll, before.explanation || {});
    assert.deepEqual(after.choices.map((choice) => ({ number: choice.number, text: choice.textAll, correct: choice.correct })), (before.choices || []).map((choice) => ({ number: choice.number, text: choice.text, correct: choice.correct })));
    const paths = before.image_paths || before.image_assets?.map((asset) => asset.local_path).filter(Boolean) || [];
    for (const original of paths) {
      if (!expectedPaths.has(original)) {
        const source = await readFile(path.join(sourceRoot, original));
        const replacement = originalMode ? null : byHash.get(sha256(source));
        expectedPaths.set(original, replacement ? `enhanced-exams/${replacement.file}` : original);
      }
    }
    assert.deepEqual(after.imagePaths, paths.map((file) => expectedPaths.get(file)));
    upgraded += after.imagePaths.filter((file) => file.startsWith("enhanced-exams/")).length;
    fallback += after.imagePaths.filter((file) => !file.startsWith("enhanced-exams/")).length;
    questions++;
  }
}
for (const file of new Set(expectedPaths.values())) assert.ok((await readFile(path.join(root, "dist/data", file))).length > 0);
console.log(`Verified ${questions} questions: all languages, answers and explanations unchanged; ${upgraded} enhanced image references, ${fallback} original references. ${originalMode ? "Rollback" : "Enhanced"} mode.`);
