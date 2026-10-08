import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash, validateTranslations, validateImagePlan } from "./knowledge-handoff.mjs";

const args = process.argv.slice(2), complete = args.includes("--complete");
const files = args.filter((arg) => arg !== "--complete");
if (!files.length) throw new Error("Usage: node scripts/validate-knowledge-handoff.mjs <handoff-folder> [result.json ...] [--complete]");
const root = path.resolve(files.shift());
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const bundle = await load(path.join(root, "bundle.json"));
const integrity = await load(path.join(root, "asset-integrity.json"));
if (integrity.packageId !== bundle.packageId) throw new Error("Wrong asset inventory package");
for (const asset of integrity.files) {
  const file = path.resolve(root, asset.path);
  if (!file.startsWith(root + path.sep) || hash(await readFile(file)) !== asset.sha256) throw new Error(`Missing/changed asset: ${asset.path}`);
}
const translations = [], plans = [], result = { version: 1, packageId: bundle.packageId, sourceAssetsValid: true };
for (const file of files) {
  const data = await load(path.resolve(file));
  if (Array.isArray(data.translations)) translations.push(data);
  else if (Array.isArray(data.images)) plans.push(data);
  else throw new Error(`Not a translation or image-plan JSON: ${file}`);
}
result.translations = validateTranslations(bundle, translations, { complete });
result.imagePlans = plans.map((plan) => validateImagePlan(bundle, plan));
// Candidate files stay outside the website. Checking identity is not proof of
// correct arrows, dimensions, colors or reuse rights; SVG needs sanitizing too.
for (const [index, plan] of plans.entries()) for (const image of plan.images) {
  if (!result.imagePlans[index].valid) continue;
  if (image.decision !== "propose_replacement") continue;
  const proposed = path.resolve(root, image.proposedFile || "");
  if (!proposed.startsWith(path.join(root, "proposed-images") + path.sep)) throw new Error("Unsafe candidate image path");
  if (hash(await readFile(proposed)) !== image.proposedSha256) throw new Error(`Candidate image hash mismatch: ${image.imageId}`);
}
result.published = false;
await writeFile(path.join(root, "validation-report.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result, null, 2));
if (!result.translations.valid || result.imagePlans.some((plan) => !plan.valid)) process.exitCode = 1;
