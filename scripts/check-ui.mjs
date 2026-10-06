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
const knowledge = JSON.parse(await readFile(path.join(dist, "data/knowledge.json"), "utf8"));
const knowledgeOnly = process.argv.includes("--knowledge");
const autoAdvanceOnly = process.argv.includes("--auto-advance");
const imagesOnly = process.argv.includes("--images");
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
    const selectors = ".topbar-inner,.nav-tabs,.language-options,.language-trigger,.exam-section-head,.exam-shortcuts,.question-nav,.question-panel,.question-dots,.question-footer,.exam-card,.article-row,.article-summary,.knowledge-list,.answer-button,.article-view,.article-body,.locations-list";
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

async function waitForQuestion(page, index) {
  await page.waitForFunction((expected) => document.querySelector(".dot.current")?.dataset.goQuestion === String(expected), index);
}

async function checkQuestionImages(page, name) {
  await page.waitForFunction(() => [...document.querySelectorAll(".question-images img")].every((img) => img.complete && img.naturalWidth > 0));
  const checks = await page.locator(".question-images img").evaluateAll((images) => images.map((img) => {
    const rect = img.getBoundingClientRect();
    const container = img.parentElement.getBoundingClientRect();
    const title = document.querySelector(".question-title").getBoundingClientRect();
    const expectedWidth = Math.min(800, container.width);
    return { width: rect.width, height: rect.height, expectedWidth, expectedHeight: Math.min(560, expectedWidth * img.naturalHeight / img.naturalWidth), centered: Math.abs((rect.left + rect.right) / 2 - (container.left + container.right) / 2), below: title.top >= rect.bottom, fit: getComputedStyle(img).objectFit };
  }));
  assert.ok(checks.length > 0, name);
  assert.ok(checks.every((item) => Math.abs(item.width - item.expectedWidth) < 2 && Math.abs(item.height - item.expectedHeight) < 2 && item.centered < 1 && item.below && item.fit === "contain"), `${name}: images must be large, centered, uncropped and above the question`);
  await checkLayout(page, name);
}

async function checkImageWorkflow(page, width, locale) {
  for (const type of ["karimen", "honmen", "gentsuki"]) {
    const item = manifest.exams.find((exam) => exam.type === type);
    const exam = JSON.parse(await readFile(path.join(dist, item.path), "utf8"));
    const index = exam.questions.findIndex((q, index) => index > 0 && q.imagePaths.length && !exam.questions[index - 1].choices.length);
    assert.ok(index > 0);
    await page.locator(`.exam-card.${type}`).first().click();
    await page.waitForSelector(".question-title");
    await openQuestionList(page);
    await page.locator(`[data-go-question="${index - 1}"]`).click();
    await page.locator('[data-answer="true"]').click();
    await waitForQuestion(page, index);
    await checkQuestionImages(page, `${width}/${locale}/${type}/image-after-advance`);
    const visible = await page.locator(".question-images").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const header = document.querySelector(".topbar");
      return rect.top < innerHeight && rect.bottom > 0 && rect.top >= (getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().bottom : 0) - 1;
    });
    assert.equal(visible, true, "Automatic progression skipped the question image");
    const compoundIndex = exam.questions.findIndex((q) => q.choices.length && q.imagePaths.length);
    if (compoundIndex >= 0) {
      await page.locator(`[data-go-question="${compoundIndex}"]`).click();
      await checkQuestionImages(page, `${width}/${locale}/${type}/illustration`);
    }
    if ((width === 390 || width === 1440) && locale === "vi") {
      await page.locator(".question-images").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshots, `${width}-${type}-large-image.png`), fullPage: true });
    }
    await page.locator("[data-back-exams]").click();
  }
}

async function checkAutoAdvance(page, width, locale) {
  for (const type of ["karimen", "honmen", "gentsuki"]) {
    const item = manifest.exams.find((exam) => exam.type === type);
    const exam = JSON.parse(await readFile(path.join(dist, item.path), "utf8"));
    await page.locator(`.exam-card.${type}`).first().click();
    await page.waitForSelector(".question-title");
    await openQuestionList(page);
    await page.locator('[data-answer="true"]').dblclick({ delay: 50 });
    await waitForQuestion(page, 1);
    assert.equal(await page.locator('[data-go-question="0"]').evaluate((el) => el.classList.contains("answered")), true);
    assert.equal(await page.locator('[data-go-question="1"]').evaluate((el) => el.classList.contains("answered")), false, "Double-click answered the next question");
    const framing = await page.locator(".question-title").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const header = document.querySelector(".topbar");
      return { focused: document.activeElement === el, top: rect.top, headerBottom: getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().bottom : 0 };
    });
    assert.equal(framing.focused, true);
    assert.ok(framing.top >= framing.headerBottom - 1, "Next question is hidden beneath the header");
    await page.locator('[data-go-question="0"]').click();
    assert.equal(await page.locator('[data-answer="true"]').getAttribute("class"), "answer-button selected");
    await page.locator('[data-answer="false"]').click();
    await waitForQuestion(page, 1);
    let choiceQuestion = null;
    if (type === "honmen") {
      const index = exam.questions.findIndex((q) => q.choices.length);
      choiceQuestion = exam.questions[index];
      await page.locator(`[data-go-question="${index}"]`).click();
      await page.locator(`[data-choice-answer="${choiceQuestion.choices[0].number}:false"]`).click();
      await page.waitForTimeout(350);
      assert.equal(await page.locator(".dot.current").getAttribute("data-go-question"), String(index));
      assert.equal(await page.locator(`[data-go-question="${index}"]`).evaluate((el) => el.classList.contains("answered")), false, "Partial question marked complete");
      const alternative = locale === "en" ? "ja" : "en";
      await selectLanguage(page, alternative);
      assert.equal(await page.locator(`[data-choice-answer="${choiceQuestion.choices[0].number}:false"]`).getAttribute("class"), "answer-button selected");
      await selectLanguage(page, locale);
      for (const choice of choiceQuestion.choices.slice(1)) {
        await page.locator(`[data-choice-answer="${choice.number}:false"]`).click();
      }
      await waitForQuestion(page, index + 1);
      assert.equal(await page.locator(`[data-go-question="${index}"]`).evaluate((el) => el.classList.contains("answered")), true, "All-false choices did not complete the question");
    }
    const last = exam.questions.at(-1);
    const lastIndex = exam.questions.length - 1;
    await page.locator(`[data-go-question="${lastIndex}"]`).click();
    if (last.choices.length) {
      for (const choice of last.choices) await page.locator(`[data-choice-answer="${choice.number}:${choice.correct}"]`).click();
    } else {
      await page.locator('[data-answer="false"]').click();
    }
    await page.waitForTimeout(350);
    assert.equal(await page.locator(".dot.current").getAttribute("data-go-question"), String(lastIndex));
    assert.equal(await page.locator(".result-box").count(), 0, "Last answer submitted the test automatically");
    assert.equal(await page.locator(`[data-go-question="${lastIndex}"]`).evaluate((el) => el.classList.contains("answered")), true);
    await page.locator("[data-submit-exam]").click();
    const points = (q) => type === "honmen" ? (q.number >= 91 ? 2 : 1) : 2;
    const expected = (exam.questions[0].correct === false ? points(exam.questions[0]) : 0)
      + (choiceQuestion?.choices.every((choice) => choice.correct === false) ? points(choiceQuestion) : 0)
      + (last.choices.length || last.correct === false ? points(last) : 0);
    const total = exam.questions.reduce((sum, q) => sum + points(q), 0);
    assert.equal(await page.locator(".result-score").textContent(), `${expected}/${total}`);
    await page.locator('[data-go-question="0"]').click();
    await page.locator('[data-answer="true"]').click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator(".dot.current").getAttribute("data-go-question"), "0", "Review answer advanced automatically");
    await checkLayout(page, `${width}/${locale}/${type}/auto-advance`);
    await page.locator("[data-back-exams]").click();
  }
  if (locale === "vi") {
    await page.locator(".exam-card.karimen").first().click();
    await page.waitForSelector(".question-title");
    await openQuestionList(page);
    await page.evaluate(() => {
      document.querySelector('[data-answer="true"]').click();
      document.querySelector("[data-next-question]").click();
    });
    await page.waitForTimeout(350);
    assert.equal(await page.locator(".dot.current").getAttribute("data-go-question"), "1", "Manual navigation did not cancel the pending transition");
    await page.evaluate(() => {
      document.querySelector('[data-answer="false"]').click();
      document.querySelector('[data-go-question="0"]').click();
    });
    await page.waitForTimeout(350);
    assert.equal(await page.locator(".dot.current").getAttribute("data-go-question"), "0");
    await page.evaluate(() => {
      document.querySelector('[data-answer="true"]').click();
      document.querySelector("[data-submit-exam]").click();
    });
    await page.waitForTimeout(350);
    assert.equal(await page.locator(".dot.current").getAttribute("data-go-question"), "0", "Grading did not cancel the pending transition");
    await page.locator("[data-back-exams]").click();
    await page.locator(".exam-card.karimen").first().click();
    await page.waitForSelector(".question-title");
    await page.evaluate(() => {
      document.querySelector('[data-answer="true"]').click();
      document.querySelector("[data-back-exams]").click();
    });
    await page.locator(".exam-card.karimen").first().click();
    await page.waitForSelector(".question-title");
    await page.waitForTimeout(350);
    assert.equal(await page.locator(".dot.current").getAttribute("data-go-question"), "0", "Previous attempt advanced the new attempt");
    await page.locator("[data-back-exams]").click();
  }
}

async function checkKnowledge(page, width, locale) {
  await page.locator('[data-tab="knowledge"]').click();
  await page.waitForSelector(".article-row");
  assert.equal(await page.locator(".article-row").count(), knowledge.length);
  if (locale !== "vi") assert.equal(await page.locator(".content-language").count(), 1);
  const dimensions = await page.locator(".article-row").evaluateAll((rows) => rows.map((row) => ({ row: row.getBoundingClientRect().width, list: row.parentElement.clientWidth })));
  assert.ok(dimensions.every(({ row, list }) => Math.abs(row - list) < 1), "Article rows must occupy the entire list width");
  await checkLayout(page, `${width}/${locale}/knowledge`);
  const search = page.locator("[data-knowledge-search]");
  await search.fill("bien bao");
  assert.equal(await page.locator('[data-open-article="vi-knowledge-traffic-signs"]').count(), 1);
  assert.ok(await page.locator(".article-row").count() < knowledge.length);
  await search.fill("zzzz-no-match");
  assert.equal(await page.locator(".empty-state").count(), 1);
  await search.fill("");
  assert.equal(await page.locator(".article-row").count(), knowledge.length);
  assert.equal(await page.locator(".article-row:disabled").count(), knowledge.filter((article) => !article.blocks.length && !article.tables.length && !article.images.length).length);
  if ((width === 390 || width === 1440) && locale === "vi") {
    await page.screenshot({ path: path.join(screenshots, `${width}-knowledge-list.png`) });
  }
  const readable = knowledge.filter((article) => article.blocks.length || article.tables.length || article.images.length);
  const articles = locale === "vi" ? readable : readable.filter((article) => ["traffic-signs", "license-vehicle"].includes(article.slug));
  for (const article of articles) {
    const row = page.locator(`[data-open-article="${article.id}"]`);
    await row.scrollIntoViewIfNeeded();
    const previousScroll = await page.evaluate(() => window.scrollY);
    await row.click();
    assert.equal(await page.locator(".article-view h1").count(), 1, article.slug);
    assert.equal(await page.locator(".article-view h1").textContent(), article.title);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    const headings = await page.locator(".article-view h1,.article-view h2,.article-view h3,.article-view h4").allTextContents();
    assert.equal(headings.filter((text) => text.trim() === article.title.trim()).length, 1, `Duplicate title in ${article.slug}`);
    for (const block of article.blocks.filter((block) => /^h[1-4]$/.test(block.tag) && block.text !== article.title)) {
      assert.ok(headings.includes(block.text), `Subheading removed from ${article.slug}`);
    }
    assert.equal(await page.locator(".article-body > li").count(), 0);
    await checkLayout(page, `${width}/${locale}/${article.slug}`);
    if (article.slug === "traffic-signs") {
      assert.equal(await page.locator(".article-table img").count(), 157);
      await page.locator(".article-table img").first().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => { const image = document.querySelector(".article-table img"); return image.complete && image.naturalWidth > 0; });
      if ((width === 390 || width === 1440) && locale === "vi") {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(screenshots, `${width}-knowledge-article.png`) });
      }
    }
    if (article.slug === "license-vehicle") assert.equal(await page.locator(".table-scroll").count(), 1);
    if (article.slug === "priority-at-intersections") {
      assert.equal(await page.locator(".article-gallery img").count(), 3);
      await page.locator(".article-gallery img").first().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll(".article-gallery img")].every((img) => img.complete && img.naturalWidth > 0));
    }
    await page.locator("[data-close-article]").click();
    assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - previousScroll) < 2, `List scroll position lost after ${article.slug}`);
  }
}

try {
  browser = await chromium.launch();
  let checks = 0;
  for (const width of autoAdvanceOnly ? [390, 1024, 1440] : [320, 390, 768, 1024, 1440, 1920]) {
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
      if (knowledgeOnly) {
        await checkKnowledge(page, width, locale);
        checks++;
        continue;
      }
      if (autoAdvanceOnly) {
        await checkAutoAdvance(page, width, locale);
        checks += 3;
        continue;
      }
      if (imagesOnly) {
        await checkImageWorkflow(page, width, locale);
        checks += 3;
        continue;
      }
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
        await waitForQuestion(page, 1);
        await page.locator('[data-go-question="0"]').click();
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
        await checkQuestionImages(page, `${width}/${locale}/${type}/image-layout`);
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
      await checkKnowledge(page, width, locale);
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
    console.log(`OK: ${width}px, all ${manifest.locales.length} languages, ${knowledgeOnly ? "knowledge list, search and article content" : autoAdvanceOnly ? "automatic progression, last question, review and cancellation" : imagesOnly ? "large centered images before question text and automatic progression" : "all exam types, knowledge and locations"}`);
  }
  console.log(`Passed ${checks} ${knowledgeOnly ? "knowledge" : autoAdvanceOnly ? "auto-advance" : imagesOnly ? "image" : "exam"} workflows. Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
