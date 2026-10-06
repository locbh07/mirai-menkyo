import assert from "node:assert/strict";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, "data/karimen-honmen-vi");
const createdAt = new Date().toISOString();
const backups = path.join(root, "output/backups");
const destination = path.join(backups, `karimen-honmen-vi-${createdAt.replaceAll(":", "-")}`);

async function inventory(directory, relative = "") {
  const files = [];
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${next}`);
    if (entry.isDirectory()) files.push(...await inventory(directory, next));
    else if (entry.isFile()) {
      const bytes = await readFile(path.join(directory, next));
      files.push({ path: next.replaceAll("\\", "/"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
  return files;
}

const before = await inventory(source);
assert.ok(before.length > 0, "Source data is empty");
await mkdir(backups, { recursive: true });
await mkdir(destination);
await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
assert.deepEqual(await inventory(destination), before, "Backup does not match original data");
assert.deepEqual(await inventory(source), before, "Source changed during backup");
const imageFiles = before.filter((file) => file.path.startsWith("assets/")).length;
const manifest = { createdAt, source: "data/karimen-honmen-vi", verified: true, fileCount: before.length, imageFiles, totalBytes: before.reduce((sum, file) => sum + file.bytes, 0), files: before };
await writeFile(path.join(destination, "backup-manifest.json"), JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ backup: destination, verified: true, fileCount: manifest.fileCount, imageFiles, totalBytes: manifest.totalBytes }, null, 2));
