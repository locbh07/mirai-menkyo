import { createHash, randomBytes, webcrypto } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_HEADER, DATA_IV_LENGTH, decodeJsonData } from "../src/data-codec.js";

export async function encodeJsonData(value, keyBase64) {
  const rawKey = Buffer.from(keyBase64, "base64");
  if (rawKey.length !== 32) throw new Error("Invalid data key");
  const key = await webcrypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const iv = randomBytes(DATA_IV_LENGTH);
  const ciphertext = await webcrypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: DATA_HEADER, tagLength: 128,
  }, key, new TextEncoder().encode(JSON.stringify(value)));
  return Buffer.concat([Buffer.from(DATA_HEADER), iv, Buffer.from(ciphertext)]);
}

export async function createDataWriter(directory) {
  // The browser receives this key: this pack is a scraping deterrent, not authorization.
  const keyBase64 = randomBytes(32).toString("base64");
  await mkdir(path.join(directory, "content"), { recursive: true });
  return {
    keyBase64,
    async write(value) {
      const bytes = await encodeJsonData(value, keyBase64);
      const file = `${createHash("sha256").update(bytes).digest("hex")}.mmdata`;
      await writeFile(path.join(directory, "content", file), bytes);
      return `data/content/${file}`;
    },
  };
}

export async function readBuiltData(file, config) {
  return decodeJsonData(await readFile(file), config.keyBase64, webcrypto.subtle);
}
