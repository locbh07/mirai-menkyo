import assert from "node:assert/strict";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { dataConfig } from "../dist/data-config.js";
import { DATA_HEADER, DATA_IV_LENGTH, decodeJsonData } from "../src/data-codec.js";
import { encodeJsonData, readBuiltData } from "./data-files.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const manifest = await readBuiltData(path.join(dist, dataConfig.manifestPath), dataConfig);
const originals = JSON.parse(await readFile(path.join(root, "data/karimen-honmen-vi/all.json"), "utf8"));
const currentLaw = JSON.parse(await readFile(path.join(root, "data/knowledge-vi/current-law-updates.json"), "utf8"));
const quickReview = JSON.parse(await readFile(path.join(root, "data/knowledge-vi/quick-review.json"), "utf8"));
assert.equal(dataConfig.version, 1);
assert.equal(manifest.dataFormat, "aes-gcm-v1");
assert.deepEqual(await readBuiltData(path.join(dist, manifest.locationsPath), dataConfig), originals.test_locations);
assert.deepEqual((await readBuiltData(path.join(dist, manifest.knowledgePath), dataConfig)).filter((article) => article.locale === "vi" && article.format !== "pdf-lessons-v1"), [...quickReview.articles, ...currentLaw.articles]);

async function filesUnder(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await filesUnder(file));
    else files.push(file);
  }
  return files;
}

const dataFiles = await filesUnder(path.join(dist, "data"));
assert.deepEqual(dataFiles.filter((file) => /\.jsonl?$/i.test(file)), [], "No plaintext dataset may remain in deployed assets");
const packets = [dataConfig.manifestPath, manifest.knowledgePath, manifest.locationsPath, ...manifest.exams.map((exam) => exam.path)];
assert.equal(dataFiles.filter((file) => file.endsWith(".mmdata")).length, packets.length);
for (const packet of packets) {
  assert.match(packet, /^data\/content\/[a-f0-9]{64}\.mmdata$/);
  const bytes = await readFile(path.join(dist, packet));
  assert.equal(path.basename(packet, ".mmdata"), createHash("sha256").update(bytes).digest("hex"));
  assert.throws(() => JSON.parse(bytes.toString("utf8")), "A downloaded packet must not be directly readable as JSON");
  await readBuiltData(path.join(dist, packet), dataConfig);
}

const sample = { unicode: originals.exam_sets[0].questions[0].text, answers: [true, false], empty: null };
const packet = await encodeJsonData(sample, dataConfig.keyBase64);
assert.deepEqual(await decodeJsonData(packet, dataConfig.keyBase64, webcrypto.subtle), sample);
const other = await encodeJsonData(sample, dataConfig.keyBase64);
assert.notDeepEqual(packet.subarray(DATA_HEADER.length, DATA_HEADER.length + DATA_IV_LENGTH), other.subarray(DATA_HEADER.length, DATA_HEADER.length + DATA_IV_LENGTH));
const corrupt = Buffer.from(packet);
corrupt[corrupt.length - 1] ^= 1;
await assert.rejects(decodeJsonData(corrupt, dataConfig.keyBase64, webcrypto.subtle));
await assert.rejects(decodeJsonData(packet, randomBytes(32).toString("base64"), webcrypto.subtle));
await assert.rejects(decodeJsonData(packet.subarray(0, 10), dataConfig.keyBase64, webcrypto.subtle));
const badHeader = Buffer.from(packet);
badHeader[0] ^= 1;
await assert.rejects(decodeJsonData(badHeader, dataConfig.keyBase64, webcrypto.subtle));
console.log(`OK: ${packets.length} encrypted packets, preserved knowledge/locations, fresh IVs, rejected tampering and wrong keys`);

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".mmdata": "application/octet-stream", ".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const file = path.join(dist, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(base);
  await page.waitForSelector(".exam-card");
  const inspector = await page.context().newCDPSession(page);
  await inspector.send("Runtime.enable");
  assert.equal((await inspector.send("Runtime.evaluate", { expression: "document.querySelectorAll('.exam-card').length", returnByValue: true })).result.value, manifest.exams.length, "Inspection remains possible: the deterrent is not a security boundary");
  const keyChecks = await page.evaluate(() => {
    const blocked = [
      { key: "F12", code: "F12" },
      ...["I", "J", "C"].map((key) => ({ key, ctrlKey: true, shiftKey: true })),
      { key: "u", ctrlKey: true },
      ...["i", "j", "c", "u"].map((key) => ({ key, metaKey: true, altKey: true })),
      { key: "c", metaKey: true, shiftKey: true },
    ];
    const allowed = [
      { key: "c", ctrlKey: true }, { key: "v", ctrlKey: true }, { key: "f", ctrlKey: true }, { key: "p", ctrlKey: true },
      { key: "i", metaKey: true, shiftKey: true }, { key: "Tab" }, { key: "ArrowDown" },
      { key: "i", ctrlKey: true, shiftKey: true, isComposing: true },
    ];
    const cancelled = (init) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return { blocked: blocked.map(cancelled), allowed: allowed.map(cancelled), contextMenu: (() => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    })() };
  });
  assert.ok(keyChecks.blocked.every(Boolean));
  assert.ok(keyChecks.allowed.every((value) => !value));
  assert.equal(keyChecks.contextMenu, false, "Do not block copying, translation and other context-menu actions");
  await page.locator(".exam-card.karimen").first().click();
  await page.waitForSelector(".question-title");
  await page.locator('[data-answer="false"]').click();
  await page.waitForFunction(() => document.querySelector(".dot.current")?.dataset.goQuestion === "1");
  await page.locator("[data-submit-exam]").click();
  await page.waitForSelector(".result-box");
  await page.locator("[data-back-exams]").click();
  await page.locator('[data-tab="knowledge"]').click();
  await page.waitForSelector(".article-row");
  await page.locator("[data-knowledge-language]").selectOption("vi");
  await page.locator("[data-knowledge-scope]").selectOption("detail");
  await page.locator('[data-open-article="vi-kyousoku-chapter-05-section-08"]').click();
  await page.waitForSelector(".pdf-article-view");
  await page.locator('[data-tab="locations"]').click();
  await page.waitForSelector(".location-row");
  await page.locator("[data-location-search]").pressSequentially("Tokyo");
  assert.equal(await page.locator("[data-location-search]").inputValue(), "Tokyo");
  assert.ok(requests.some((url) => url.endsWith(".mmdata")));
  assert.deepEqual(requests.filter((url) => /\.jsonl?$/.test(url)), []);
  for (const legacy of ["data/manifest.json", "data/knowledge.json", "data/locations.json", "data/exams/karimen/exam-1.json"]) {
    assert.equal((await page.request.get(`${base}/${legacy}`)).status(), 404);
  }
  assert.deepEqual(errors, []);
  await inspector.detach();
  console.log("OK: browser decoding, practice/grading, theory, locations, shortcut cancellation and preserved editing/IME keys; no runtime JSON requests");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
