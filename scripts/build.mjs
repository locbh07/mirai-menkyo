import { cp, mkdir, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareData } from "./prepare-data.mjs";
import { iconNames } from "../src/icons.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, "src"), dist, { recursive: true });
const iconsRoot = path.join(root, "node_modules/lucide-static");
const iconsDist = path.join(dist, "assets/icons");
await mkdir(iconsDist, { recursive: true });
for (const name of iconNames) {
  await copyFile(path.join(iconsRoot, "icons", `${name}.svg`), path.join(iconsDist, `${name}.svg`));
}
await copyFile(path.join(iconsRoot, "LICENSE"), path.join(iconsDist, "LICENSE"));
await prepareData();

const headersPath = path.join(root, "_headers");
if (existsSync(headersPath)) {
  await copyFile(headersPath, path.join(dist, "_headers"));
}

console.log(`Built ${dist}`);
