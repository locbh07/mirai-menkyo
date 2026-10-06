import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { languages, languageFlags } from "../src/i18n.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const screenshots = path.join(dist, "ui-check");
await mkdir(screenshots, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(dist, "data/manifest.json"), "utf8"));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg" };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.join(dist, pathname === "/" ? "index.html" : decodeURIComponent(pathname));
    const contents = await readFile(file);
    response.writeHead(200, { "Content-Type": `${mime[path.extname(file)] || "application/octet-stream"}; charset=utf-8` });
    response.end(contents);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;

async function checkLayout(page, name) {
  const errors = await page.evaluate(() => {
    const problems = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) problems.push("Page overflows horizontally");
    const selectors = ".topbar-inner,.nav-tabs,.language-options,.language-trigger,.exam-section-head,.exam-shortcuts,.question-nav,.question-panel,.question-dots,.question-footer,.exam-card,.article-card,.answer-button,.article-view,.locations-list";
    for (const element of document.querySelectorAll(selectors)) {
      if (!element.getClientRects().length) continue;
      if (element.scrollWidth > element.clientWidth + 1) problems.push(`${element.className} overflows internally`);
    }
    const nav = document.querySelector(".question-nav")?.getBoundingClientRect();
    const panel = document.querySelector(".question-panel")?.getBoundingClientRect();
    if (nav && panel && innerWidth > 900 && nav.right > panel.left) problems.push("Sidebar overlaps question panel");
    for (const dot of document.querySelectorAll(".dot")) {
      if (!dot.getClientRects().length) continue;
      const rect = dot.getBoundingClientRect();
      if (rect.left < nav.left || rect.right > nav.right) problems.push("Question button escapes sidebar");
      if (rect.width < 43.9 || rect.height < 43.9) problems.push("Question button touch target smaller than 44px");
    }
    return problems;
  });
  assert.deepEqual(errors, [], name);
}

async function openQuestionList(page) {
  if (!(await page.locator(".question-list").evaluate((el) => el.open))) {
    await page.locator(".question-list summary").click();
  }
}

async function selectLanguage(page, locale) {
  if (!(await page.locator(".language-menu").evaluate((el) => el.open))) {
    await page.locator(".language-trigger").click();
  }
  await checkLayout(page, `Language menu/${locale}`);
  await page.waitForFunction(() => [...document.querySelectorAll(".language-flag")].every((img) => img.complete && img.naturalWidth > 0));
  assert.equal(await page.locator("[data-locale]").count(), manifest.locales.length);
  await page.locator(`[data-locale="${locale}"]`).click();
  assert.equal(await page.locator(".language-menu").evaluate((el) => el.open), false);
  assert.equal(await page.locator(".language-trigger span").textContent(), languages[locale]);
  assert.equal(await page.locator(".language-trigger img").getAttribute("src"), `assets/flags/${languageFlags[locale]}.png`);
}

try {
  browser = await chromium.launch();
  let checks = 0;
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    const height = width === 320 ? 640 : width === 390 ? 844 : 960;
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    for (const locale of manifest.locales) {
      await page.goto(base);
      await page.waitForSelector(".exam-card");
      await selectLanguage(page, locale);
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      assert.equal(await page.locator(".exam-section").count(), 3);
      assert.equal(await page.locator(".exam-card").count(), manifest.exams.length);
      for (const type of ["karimen", "honmen", "gentsuki"]) {
        const section = page.locator(`[data-exam-type="${type}"]`);
        assert.equal(await section.locator(`.exam-card.${type}`).count(), manifest.exams.filter((exam) => exam.type === type).length);
        assert.equal(await section.locator(`.exam-card:not(.${type})`).count(), 0);
        await page.locator(`.exam-shortcut.${type}`).click();
        assert.equal(new URL(page.url()).hash, `#exams-${type}`);
      }
      await checkLayout(page, `${width}/${locale}/home`);
      await page.locator(".language-trigger").focus();
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.locator(".language-menu").evaluate((el) => el.open), true);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.locale), manifest.locales[0]);
      await page.keyboard.press("End");
      assert.equal(await page.evaluate(() => document.activeElement.dataset.locale), manifest.locales.at(-1));
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".language-menu").evaluate((el) => el.open), false);
      await page.locator(".language-trigger").click();
      await page.locator(".brand-mark").click();
      assert.equal(await page.locator(".language-menu").evaluate((el) => el.open), false);
      if ((width === 390 || width === 1440) && (locale === "vi" || locale === "pt")) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(screenshots, `${width}-${locale}-home.png`), fullPage: true });
        await page.locator(".language-trigger").click();
        await page.screenshot({ path: path.join(screenshots, `${width}-${locale}-languages.png`) });
        await page.keyboard.press("Escape");
      }
      for (const type of ["karimen", "honmen", "gentsuki"]) {
        const item = manifest.exams.find((exam) => exam.type === type);
        const exam = JSON.parse(await readFile(path.join(dist, item.path), "utf8"));
        await page.locator(`.exam-card.${type}`).first().click();
        await page.waitForSelector(".question-title");
        assert.equal(await page.evaluate(() => window.scrollY), 0);
        assert.ok((await page.locator(".question-title").textContent()).includes(exam.questions[0].textAll[locale]));
        if (width <= 900) assert.equal(await page.locator(".question-list").evaluate((el) => el.open), false);
        if ((width === 390 || width === 1440) && locale === "vi" && type === "karimen") {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: path.join(screenshots, `${width}-vi-practice.png`), fullPage: true });
        }
        await openQuestionList(page);
        await checkLayout(page, `${width}/${locale}/${type}`);
        await page.locator('[data-answer="true"]').click();
        const alternative = locale === "en" ? "ja" : "en";
        const timerBefore = await page.locator(".timer").textContent();
        await selectLanguage(page, alternative);
        assert.equal(await page.locator('[data-answer="true"]').getAttribute("class"), "answer-button selected");
        assert.ok((await page.locator(".question-title").textContent()).includes(exam.questions[0].textAll[alternative]));
        const seconds = (time) => time.split(":").reduce((m, n) => m * 60 + Number(n), 0);
        assert.ok(seconds(await page.locator(".timer").textContent()) <= seconds(timerBefore));
        await selectLanguage(page, locale);
        const imageIndex = exam.questions.findIndex((q) => q.imagePaths.length && (type !== "honmen" || q.choices.length));
        await page.locator(`[data-go-question="${imageIndex}"]`).click();
        const images = page.locator(".question-images img");
        await images.first().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll(".question-images img")].every((img) => img.complete && img.naturalWidth > 0));
        if (type === "honmen") {
          const question = exam.questions[imageIndex];
          assert.equal(await page.locator(".choice-text").first().textContent(), question.choices[0].textAll[locale]);
          await page.locator('[data-choice-answer="1:true"]').click();
          const navScroll = await page.locator(".question-list").evaluate((el) => el.scrollTop);
          await selectLanguage(page, alternative);
          assert.equal(await page.locator(".question-list").evaluate((el) => el.scrollTop), navScroll);
          assert.equal(await page.locator('[data-choice-answer="1:true"]').getAttribute("class"), "answer-button selected");
          assert.equal(await page.locator(".choice-text").first().textContent(), question.choices[0].textAll[alternative]);
          await selectLanguage(page, locale);
        }
        await checkLayout(page, `${width}/${locale}/${type}/image`);
        const explanationIndex = exam.questions.findIndex((q) => q.explanationAll[locale]);
        if (explanationIndex >= 0) await page.locator(`[data-go-question="${explanationIndex}"]`).click();
        await page.locator("[data-submit-exam]").click();
        const points = (q) => type === "honmen" ? (q.number >= 91 ? 2 : 1) : 2;
        const expectedScore = exam.questions[0].correct === true ? points(exam.questions[0]) : 0;
        const total = exam.questions.reduce((sum, q) => sum + points(q), 0);
        assert.equal(await page.locator(".result-score").textContent(), `${expectedScore}/${total}`);
        if (explanationIndex >= 0) {
          assert.ok((await page.locator(".explanation").textContent()).includes(exam.questions[explanationIndex].explanationAll[locale]));
        }
        await checkLayout(page, `${width}/${locale}/${type}/result`);
        if ((width === 390 || width === 1440) && (locale === "vi" || locale === "pt")) {
          await page.locator('[data-go-question="0"]').click();
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: path.join(screenshots, `${width}-${locale}-${type}.png`), fullPage: true });
        }
        await page.locator("[data-back-exams]").click();
        checks++;
      }
      await page.locator('[data-tab="knowledge"]').click();
      await page.waitForSelector(".article-card");
      await checkLayout(page, `${width}/${locale}/knowledge`);
      if (locale !== "vi") assert.equal(await page.locator(".content-language").count(), 1);
      await page.locator('[data-open-article="vi-knowledge-license-vehicle"]').click();
      await checkLayout(page, `${width}/${locale}/wide-table`);
      assert.equal(await page.locator(".table-scroll").count(), 1);
      await page.locator('[data-tab="locations"]').click();
      await page.waitForSelector(".location-row");
      await checkLayout(page, `${width}/${locale}/locations`);
      await page.locator("[data-location-search]").fill("zzzz-no-match");
      assert.equal(await page.locator(".empty-state").count(), 1);
      await page.locator('[data-tab="exams"]').click();
      await page.reload();
      await page.waitForSelector(".exam-card");
      assert.equal(await page.locator(".language-trigger span").textContent(), languages[locale]);
    }
    assert.deepEqual(pageErrors, [], `Browser errors at width ${width}`);
    await context.close();
    console.log(`OK: ${width}px, all ${manifest.locales.length} languages, all exam types, knowledge and locations`);
  }
  console.log(`Passed ${checks} exam workflows. Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
