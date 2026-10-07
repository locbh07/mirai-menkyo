import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { dataConfig } from "../dist/data-config.js";
import { encodeJsonData, readBuiltData } from "./data-files.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const output = path.join(root, "output/pink-ui");
await mkdir(output, { recursive: true });
const manifest = await readBuiltData(path.join(dist, dataConfig.manifestPath), dataConfig);
const exams = await Promise.all(manifest.exams.map(async (item) => ({
  item, data: await readBuiltData(path.join(dist, item.path), dataConfig),
})));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const file = path.join(dist, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const allViewports = [[320, 568], [390, 664], [390, 844], [768, 1024], [1024, 768], [1440, 900], [844, 390], [568, 320]];
const viewports = process.argv.includes("--short-screen") ? allViewports.filter(([, height]) => height < 540) : allViewports;
const report = { checks: 0, innerScroll: [], errors: [], viewports };
let browser;

async function navigate(page, index) {
  await page.locator("[data-toggle-questions]").click();
  assert.equal(await page.locator("[data-toggle-questions]").getAttribute("aria-expanded"), "true");
  await page.locator(`[data-go-question="${index}"]`).click();
  assert.equal(await page.locator(".question-nav").isVisible(), false);
}

async function check(page, name, question, locale, allowInnerScroll) {
  await page.waitForSelector('.question-body[data-layout-ready="true"]');
  await page.waitForFunction(() => [...document.querySelectorAll(".question-images img")].every((image) => image.complete && image.naturalWidth > 0));
  const result = await page.evaluate(() => {
    const body = document.querySelector(".question-body");
    const copy = body.querySelector(".question-copy");
    const sideways = getComputedStyle(copy).display !== "contents";
    const readingArea = sideways ? copy : body;
    const title = document.querySelector(".question-title");
    const footer = document.querySelector(".question-footer").getBoundingClientRect();
    const controls = [...document.querySelectorAll(".question-panel button, .question-topline summary")].filter((button) => button.getClientRects().length);
    const problems = [];
    if (document.documentElement.scrollHeight > innerHeight + 1 || window.scrollY !== 0) problems.push("Practice page requires vertical scrolling");
    if (document.documentElement.scrollWidth > innerWidth + 1) problems.push("Page overflows horizontally");
    if (footer.bottom > innerHeight || footer.top < 0) problems.push("Footer leaves viewport");
    for (const button of controls) {
      const rect = button.getBoundingClientRect();
      if (rect.width < 43.9 || rect.height < 43.9) problems.push("Control smaller than 44px");
      if (rect.left < 0 || rect.right > innerWidth + 1 || rect.width < button.scrollWidth - 1) problems.push("Control or label overflows horizontally");
      if (button.matches("[data-answer]")) {
        if (rect.bottom > innerHeight || rect.top < Math.min(title.getBoundingClientRect().bottom, body.getBoundingClientRect().bottom) - 1) problems.push("True/False controls leave viewport or cover text");
      }
      if (body.classList.contains("stepped-choices") && button.matches("[data-choice-answer]")) {
        if (rect.bottom > body.getBoundingClientRect().bottom + 1 || rect.top < body.getBoundingClientRect().top) problems.push("Statement answer controls leave the reading area");
      }
    }
    for (const image of document.querySelectorAll(".question-images img")) {
      const rect = image.getBoundingClientRect();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 48;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, 48, 48);
      const pixels = context.getImageData(0, 0, 48, 48).data;
      if (!pixels.some((value, index) => index % 4 !== 3 && value < 245 && pixels[index - index % 4 + 3] > 40)) problems.push("Image rendered blank");
      if (getComputedStyle(image).objectFit !== "contain") problems.push("Image may be cropped");
      if (sideways ? rect.right > copy.getBoundingClientRect().left + 1 : rect.bottom > title.getBoundingClientRect().top) problems.push("Image overlaps question text");
      if (rect.top < body.getBoundingClientRect().top - 1) problems.push("Image starts outside question body");
    }
    if (parseFloat(getComputedStyle(title).fontSize) < 16) problems.push("Question text is too small");
    return { problems, scroll: readingArea.scrollHeight - readingArea.clientHeight, primary: getComputedStyle(document.documentElement).getPropertyValue("--navy").trim() };
  });
  assert.deepEqual(result.problems, [], name);
  assert.equal(result.primary, "#c72573");
  assert.ok((await page.locator(".question-title").textContent()).includes(question.textAll?.[locale] || question.text), "Full question text must be preserved");
  for (const [index, choice] of question.choices.entries()) {
    assert.equal(await page.locator(".choice-text").nth(index).textContent(), choice.textAll?.[locale] || choice.text);
  }
  if (result.scroll > 1) {
    report.innerScroll.push({ name, pixels: result.scroll });
    assert.ok(allowInnerScroll, `${name}: ordinary questions must fit without inner scrolling`);
  }
  report.checks++;
}

try {
  browser = await chromium.launch();
  for (const [width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height } });
    for (const locale of manifest.locales) {
      const page = await context.newPage();
      page.on("pageerror", (error) => report.errors.push(error.message));
      await page.addInitScript((lang) => localStorage.setItem("mirai-menkyo-locale", lang), locale);
      for (const type of ["karimen", "honmen", "gentsuki"]) {
        const sets = exams.filter(({ item }) => item.type === type);
        const original = sets[0];
        const length = (q) => (q.textAll?.[locale] || q.text).length + q.choices.reduce((sum, choice) => sum + (choice.textAll?.[locale] || choice.text).length, 0);
        const sorted = sets.flatMap(({ data }) => data.questions).sort((a, b) => length(b) - length(a));
        const candidates = [...new Map([
          original.data.questions[0], original.data.questions.find((q) => q.imagePaths.length),
          sorted.find((q) => !q.choices.length && !q.imagePaths.length),
          sorted.find((q) => !q.choices.length && q.imagePaths.length),
          sorted.find((q) => q.imagePaths.length > 1),
          sorted.find((q) => q.choices.length),
        ].filter(Boolean).map((q) => [q.id, q])).values()];
        // Real unmodified questions from all sets, replayed together to exercise the longest translations.
        const routeUrl = `${base}/${original.item.path}`;
        await page.route(routeUrl, async (route) => route.fulfill({ contentType: "application/octet-stream", body: await encodeJsonData({ ...original.data, questions: candidates }, dataConfig.keyBase64) }));
        await page.goto(base);
        await page.locator(`.exam-card.${type}`).first().click();
        await page.waitForSelector(".question-title");
        for (const [index, question] of candidates.entries()) {
          if (index) await navigate(page, index);
          await check(page, `${width}x${height}/${locale}/${question.id}`, question, locale, height < 600 || question.choices.length > 0);
          if (await page.locator(".stepped-choices").count()) {
            for (let part = 0; part < question.choices.length; part++) {
              await page.locator(`[data-choice-step="${part}"]`).click();
              assert.equal(await page.locator(".choice-item:visible").count(), 1);
              assert.equal(await page.locator(".choice-step.active").getAttribute("data-choice-step"), String(part));
              await check(page, `${width}x${height}/${locale}/${question.id}/part-${part + 1}`, question, locale, height < 600 || question.choices.length > 0);
            }
            await page.locator('[data-choice-step="0"]').focus();
            await page.keyboard.press("End");
            assert.equal(await page.locator(".choice-step.active").getAttribute("data-choice-step"), String(question.choices.length - 1));
            await page.keyboard.press("Home");
            assert.equal(await page.locator(".choice-step.active").getAttribute("data-choice-step"), "0");
          }
          if (locale === "vi" && (width === 390 && height === 844 || width === 1440) && (index === 0 || question.imagePaths.length)) {
            await page.screenshot({ path: path.join(output, `${width}-${height}-${question.id}.png`) });
          }
        }
        await page.locator("[data-toggle-questions]").click();
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".question-nav").isVisible(), false);
        assert.equal(await page.locator("[data-toggle-questions]").evaluate((button) => document.activeElement === button), true);
        await page.locator(".practice-menu > summary").click();
        await page.locator(".language-trigger").click();
        await page.locator(`[data-locale="${locale === "en" ? "vi" : "en"}"]`).click();
        assert.equal(await page.locator(".practice-menu").evaluate((menu) => menu.open), false);
        await page.locator(".practice-menu > summary").click();
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".practice-menu").evaluate((menu) => menu.open), false);
        await page.unroute(routeUrl);
      }
      await page.close();
    }
    await context.close();
    console.log(`OK: ${width}x${height}, all six languages, longest questions, images and compact menus`);
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 664 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("mirai-menkyo-locale", "vi"));
  await page.goto(base);
  await page.locator(".exam-card.honmen").first().click();
  await page.waitForSelector(".question-title");
  const realExam = exams.find(({ item }) => item.type === "honmen").data;
  const compoundIndex = realExam.questions.findIndex((question) => question.choices.length);
  await navigate(page, compoundIndex);
  await page.waitForSelector(".stepped-choices");
  await page.locator('[data-choice-answer="1:false"]').click();
  await page.locator('[data-choice-step="2"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".choice-step.active").getAttribute("data-choice-step"), "2", "Manual statement navigation must cancel pending progression");
  assert.equal(await page.locator('[data-choice-answer="3:false"]').isEnabled(), true, "Cancelling progression must unlock answer buttons");
  await page.locator('[data-choice-answer="3:false"]').click();
  await page.waitForFunction(() => document.querySelector(".choice-step.active")?.dataset.choiceStep === "1");
  await page.locator('[data-choice-answer="2:false"]').click();
  await page.waitForFunction((index) => document.querySelector(".dot.current")?.dataset.goQuestion === String(index + 1), compoundIndex);
  await navigate(page, compoundIndex);
  await page.waitForSelector(".stepped-choices");
  await page.locator('[data-choice-step="1"]').click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => !document.querySelector(".question-body").classList.contains("stepped-choices"));
  assert.equal(await page.locator(".choice-item:visible").count(), 3);
  assert.equal(await page.locator(".choice-item .answer-button.selected").count(), 3);
  await page.setViewportSize({ width: 390, height: 664 });
  await page.waitForSelector(".stepped-choices");
  assert.equal(await page.locator(".choice-item:visible").count(), 1);
  assert.equal(await page.locator(".choice-step.active").getAttribute("data-choice-step"), "1", "Resizing must preserve the active statement");
  await check(page, "resize/vi/compound", realExam.questions[compoundIndex], "vi", true);
  await page.locator("[data-submit-exam]").click();
  await page.waitForSelector(".result-box");
  await check(page, "graded/vi/compound", realExam.questions[compoundIndex], "vi", true);
  await context.close();
  console.log("OK: real compound answers, statement cancellation, automatic progression, resize and grading");
  assert.deepEqual(report.errors, []);
  console.log(`Passed ${report.checks} viewport checks; ${report.innerScroll.length} long/short-screen cases use contained inner scrolling. Report: ${output}`);
} finally {
  await writeFile(path.join(output, "viewport-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
