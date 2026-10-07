import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";
import { hasDockedToolsSignal, hasDeviceEmulationSignal } from "../src/devtools-guard.js";
import { languages, translate } from "../src/i18n.js";

const normal = { outerWidth: 1288, outerHeight: 890, innerWidth: 1280, innerHeight: 800, ratio: 1, mobile: false, finePointer: true, fullscreen: false };
const docked = { ...normal, outerWidth: 1700 };
assert.equal(hasDockedToolsSignal(normal), false);
assert.equal(hasDockedToolsSignal(docked), true);
assert.equal(hasDockedToolsSignal({ ...normal, outerHeight: 1160 }), true);
for (const exception of [
  { mobile: true }, { finePointer: false }, { fullscreen: true },
  { outerWidth: 900 }, { outerHeight: 500 }, { outerHeight: 1200 },
  { outerWidth: NaN }, { ratio: 1.25 },
]) assert.equal(hasDockedToolsSignal({ ...docked, ...exception }, 1), false);
console.log("OK: desktop geometry policy, mobile/touch, fullscreen, small windows, zoom and invalid metrics");

const desktopBaseline = { screenWidth: 1440, screenHeight: 900, touchPoints: 0, mobileAgent: false };
const emulated = { platform: "Win32", userAgent: devices["iPhone 13"].userAgent, mobileAgent: true, touchPoints: 1, screenWidth: 390, screenHeight: 844, fullscreen: false };
assert.equal(hasDeviceEmulationSignal(emulated), true, "Mobile UA with desktop platform is suspicious at startup");
assert.equal(hasDeviceEmulationSignal({ ...emulated, platform: "iPhone" }), false);
assert.equal(hasDeviceEmulationSignal({ ...emulated, platform: "Linux armv8l", userAgent: "Android" }), false);
assert.equal(hasDeviceEmulationSignal({ ...emulated, platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh) Mobile Safari", touchPoints: 5 }), false, "iPadOS desktop-site mode is legitimate");
assert.equal(hasDeviceEmulationSignal({ ...emulated, mobileAgent: false, userAgent: "Windows" }, desktopBaseline), true, "Touch emulation can leave the desktop UA unchanged");
assert.equal(hasDeviceEmulationSignal({ ...emulated, platform: "Linux armv8l" }, desktopBaseline), true, "A remembered desktop baseline survives platform spoofing");
assert.equal(hasDeviceEmulationSignal({ ...emulated, mobileAgent: false, screenWidth: 1440, screenHeight: 900 }, desktopBaseline), false, "Touch alone must not block");
assert.equal(hasDeviceEmulationSignal({ ...emulated, mobileAgent: false, touchPoints: 0 }, desktopBaseline), false, "Resize alone must not block");
assert.equal(hasDeviceEmulationSignal({ ...emulated, mobileAgent: false }, { ...desktopBaseline, touchPoints: 5 }), false, "Existing touch laptops must not be mistaken for newly enabled emulation");
console.log("OK: device emulation policy, native phones, iPadOS desktop mode, touch laptops and resizing");

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const screenshots = path.join(root, "output/guard-preview");
await mkdir(screenshots, { recursive: true });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg" };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const bytes = await readFile(path.join(dist, pathname === "/" ? "index.html" : decodeURIComponent(pathname)));
    response.writeHead(200, { "Content-Type": mime[path.extname(pathname)] || (pathname === "/" ? "text/html" : "application/octet-stream") });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];

// Only the test harness changes geometry. Production code has no test override.
async function newPage(options = {}, { suspect = false, locale = "vi", platform } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ...options });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ suspect, locale, platform }) => {
    localStorage.setItem("mirai-menkyo-locale", locale);
    window.testGeometry = { suspect };
    if (platform) Object.defineProperty(navigator, "platform", { configurable: true, get: () => platform });
    Object.defineProperty(window, "outerWidth", { configurable: true, get: () => window.testGeometry.suspect ? Math.max(1440, innerWidth + 420) : innerWidth + 8 });
    Object.defineProperty(window, "outerHeight", { configurable: true, get: () => Math.max(700, innerHeight + 90) });
  }, { suspect, locale, platform });
  return page;
}

async function geometry(page, suspect) {
  await page.evaluate((value) => { window.testGeometry.suspect = value; }, suspect);
}

async function checkModal(page) {
  const issues = await page.locator(".devtools-notice").evaluate((dialog) => {
    const issues = [];
    const bounds = dialog.getBoundingClientRect();
    if (!dialog.matches(":modal")) issues.push("Not a native modal");
    if (!dialog.contains(document.activeElement)) issues.push("Focus escaped dialog");
    if (bounds.left < 0 || bounds.top < 0 || bounds.right > innerWidth + 1 || bounds.bottom > innerHeight + 1) issues.push("Modal escapes viewport");
    if (dialog.scrollWidth > dialog.clientWidth + 1) issues.push("Horizontal overflow");
    const button = dialog.querySelector("button").getBoundingClientRect();
    if (button.width < 44 || button.height < 44) issues.push("Retry target is too small");
    for (const element of dialog.querySelectorAll("h2,p,button")) {
      if (element.getClientRects().length && element.scrollWidth > element.clientWidth + 1) issues.push("Text overflows");
    }
    return issues;
  });
  assert.deepEqual(issues, []);
}

try {
  browser = await chromium.launch();
  for (const locale of Object.keys(languages)) {
    const page = await newPage({}, { suspect: true, locale });
    let packets = 0;
    page.on("request", (request) => { if (request.url().endsWith(".mmdata")) packets += 1; });
    await page.goto(base);
    await page.waitForSelector(".devtools-notice[open]");
    assert.equal(packets, 0, "Suspected tools at startup must gate catalog fetch");
    assert.equal(await page.locator("#devtools-notice-message").textContent(), translate(locale, "devtoolsMessage"));
    assert.equal(await page.locator(".devtools-notice-retry span").textContent(), translate(locale, "retry"));
    await checkModal(page);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".devtools-notice").getAttribute("open"), "");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(".devtools-notice").evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await page.locator(".devtools-notice-retry").click();
    assert.equal(await page.locator(".devtools-notice-status").textContent(), translate(locale, "devtoolsRetryFailed"));
    await checkModal(page);
    if (locale === "vi") await page.screenshot({ path: path.join(screenshots, "desktop-retry.png") });
    await geometry(page, false);
    await page.locator(".devtools-notice-retry").click();
    await page.waitForSelector(".exam-card");
    assert.equal(await page.locator(".devtools-notice").getAttribute("open"), null);
    assert.ok(packets > 0);
    await page.close();
  }
  console.log("OK: six languages, startup fetch gating, truthful retry status, Escape/focus trapping, retry recovery");

  const page = await newPage();
  await page.goto(base);
  await page.waitForSelector(".exam-card");
  await page.locator(".exam-card.karimen").first().click();
  await page.waitForSelector(".question-title");
  await page.locator('[data-answer="false"]').click();
  await page.waitForFunction(() => document.querySelector(".dot.current")?.dataset.goQuestion === "1");
  await geometry(page, true);
  await page.waitForSelector(".devtools-notice[open]");
  await checkModal(page);
  const before = await page.locator(".timer").textContent();
  const question = await page.locator(".question-title").textContent();
  await page.waitForTimeout(1600);
  assert.equal(await page.locator(".timer").textContent(), before, "Clock pauses while blocked");
  assert.equal(await page.locator(".question-title").textContent(), question);
  assert.equal(await page.locator('[data-go-question="0"]').evaluate((button) => button.classList.contains("answered")), true);
  await page.screenshot({ path: path.join(screenshots, "practice-paused.png") });
  await geometry(page, false);
  await page.waitForSelector(".devtools-notice[open]", { state: "hidden" });
  await page.waitForFunction((before) => document.querySelector(".timer")?.textContent !== before, before);
  assert.equal(await page.locator(".question-title").textContent(), question);
  await page.locator("[data-toggle-questions]").click();
  await page.locator('[data-go-question="0"]').click();
  assert.equal(await page.locator('[data-answer="false"]').getAttribute("aria-pressed"), "true", "Selected answer survives block and resume");
  await page.locator('[data-answer="true"]').click();
  await page.waitForFunction(() => document.querySelector(".dot.current")?.dataset.goQuestion === "1");
  await page.locator("[data-submit-exam]").click();
  await page.waitForSelector(".result-box");
  await page.close();
  console.log("OK: modal survives practice renders, clock pauses/resumes, answers retained, auto recovery and grading");

  for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 640 }]) {
    const narrow = await newPage({ viewport }, { suspect: true, locale: "pt" });
    await narrow.goto(base);
    await narrow.waitForSelector(".devtools-notice[open]");
    await narrow.locator(".devtools-notice-retry").click();
    await checkModal(narrow);
    await narrow.screenshot({ path: path.join(screenshots, `narrow-${viewport.width}.png`) });
    await narrow.close();
  }
  for (const device of [devices["iPhone 13"], devices["iPad (gen 7)"]]) {
    // Playwright's device profile does not change the host's navigator.platform.
    const mobile = await newPage(device, { suspect: true, platform: device.userAgent.includes("iPad") ? "iPad" : "iPhone" });
    await mobile.goto(base);
    await mobile.waitForSelector(".exam-card");
    await mobile.waitForTimeout(1100);
    assert.equal(await mobile.locator(".devtools-notice").getAttribute("open"), null, "Touch/mobile devices are excluded");
    await mobile.close();
  }
  const shortPage = await newPage({ viewport: { width: 568, height: 320 } }, { suspect: true });
  await shortPage.goto(base);
  await shortPage.waitForSelector(".exam-card");
  await shortPage.waitForTimeout(1100);
  assert.equal(await shortPage.locator(".devtools-notice").getAttribute("open"), null, "Ambiguous geometry on a short screen must not block");
  await shortPage.close();
  const normalPage = await newPage();
  await normalPage.goto(base);
  await normalPage.waitForSelector(".exam-card");
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await normalPage.setViewportSize(viewport);
    await normalPage.waitForTimeout(1100);
    assert.equal(await normalPage.locator(".devtools-notice").getAttribute("open"), null, "Ordinary resizing must not block");
  }
  await normalPage.close();

  const emulationPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  emulationPage.on("pageerror", (error) => errors.push(error.message));
  await emulationPage.goto(base);
  await emulationPage.waitForSelector(".exam-card");
  await emulationPage.locator(".exam-card.karimen").first().click();
  await emulationPage.waitForSelector(".question-title");
  await emulationPage.locator('[data-answer="true"]').click();
  await emulationPage.waitForFunction(() => document.querySelector(".dot.current")?.dataset.goQuestion === "1");
  const cdp = await emulationPage.context().newCDPSession(emulationPage);
  // Use real Chromium emulation: no JS geometry overrides in this scenario.
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await emulationPage.waitForSelector(".devtools-notice[open]");
  await checkModal(emulationPage);
  const paused = await emulationPage.locator(".timer").textContent();
  await emulationPage.waitForTimeout(1200);
  assert.equal(await emulationPage.locator(".timer").textContent(), paused);
  await emulationPage.locator(".devtools-notice-retry").click();
  assert.equal(await emulationPage.locator(".devtools-notice-status").isVisible(), true);
  // Playwright screenshots restore its configured desktop viewport; capture via CDP instead.
  const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(screenshots, "chromium-mobile-emulation.png"), Buffer.from(capture.data, "base64"));
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await emulationPage.waitForSelector(".devtools-notice[open]", { state: "hidden" });
  assert.equal(await emulationPage.locator('[data-go-question="0"]').evaluate((button) => button.classList.contains("answered")), true);
  assert.equal(await emulationPage.locator(".dot.current").getAttribute("data-go-question"), "1");
  await emulationPage.waitForFunction((paused) => document.querySelector(".timer")?.textContent !== paused, paused);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await emulationPage.waitForSelector(".devtools-notice[open]");
  let reloadPackets = 0;
  emulationPage.on("request", (request) => { if (request.url().endsWith(".mmdata")) reloadPackets += 1; });
  await emulationPage.reload();
  await emulationPage.waitForSelector(".devtools-notice[open]");
  assert.equal(reloadPackets, 0, "Desktop baseline survives reload with mobile mode already on");
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await emulationPage.waitForSelector(".devtools-notice[open]", { state: "hidden" });
  await emulationPage.waitForSelector(".exam-card");
  assert.ok(reloadPackets > 0);
  await cdp.detach();
  await emulationPage.close();

  const startupEmulated = await newPage(devices["iPhone 13"]);
  await startupEmulated.goto(base);
  await startupEmulated.waitForSelector(".devtools-notice[open]");
  await checkModal(startupEmulated);
  await startupEmulated.close();
  const nativeIpad = await newPage({ ...devices["iPad (gen 7)"], userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }, { platform: "MacIntel" });
  await nativeIpad.goto(base);
  await nativeIpad.waitForSelector(".exam-card");
  assert.equal(await nativeIpad.locator(".devtools-notice").getAttribute("open"), null);
  await nativeIpad.close();
  assert.deepEqual(errors, []);
  console.log("OK: narrow modal layout, touch exclusions, ordinary resizing, no browser errors");
  console.log("OK: actual Chromium mobile/touch/DPR emulation, paused clock, retry, reload gating, recovery, startup UA mismatch and iPadOS desktop-site exclusion");
  console.log("Geometry fixtures and Chromium CDP emulation are tested; DevTools detection remains a bypassable heuristic.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
