import { cp, mkdir, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareData } from "./prepare-data.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, "src"), dist, { recursive: true });
await prepareData();

const headersPath = path.join(root, "_headers");
if (existsSync(headersPath)) {
  await copyFile(headersPath, path.join(dist, "_headers"));
}

console.log(`Built ${dist}`);
