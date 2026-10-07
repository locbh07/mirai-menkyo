export const DATA_HEADER = new Uint8Array([0x4d, 0x4d, 0x44, 0x31]);
export const DATA_IV_LENGTH = 12;

export async function decodeJsonData(payload, keyBase64, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error("Data decoding requires HTTPS or localhost");
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (bytes.length < DATA_HEADER.length + DATA_IV_LENGTH + 16 || !DATA_HEADER.every((byte, index) => bytes[index] === byte)) {
    throw new Error("Unsupported data packet");
  }
  const rawKey = Uint8Array.from(atob(keyBase64), (character) => character.charCodeAt(0));
  if (rawKey.length !== 32) throw new Error("Invalid data key");
  const key = await subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const decoded = await subtle.decrypt({
    name: "AES-GCM",
    iv: bytes.slice(DATA_HEADER.length, DATA_HEADER.length + DATA_IV_LENGTH),
    additionalData: DATA_HEADER,
    tagLength: 128,
  }, key, bytes.slice(DATA_HEADER.length + DATA_IV_LENGTH));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
}
