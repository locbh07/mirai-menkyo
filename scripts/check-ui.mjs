import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { languages, languageFlags, translate } from "../src/i18n.js";
import { iconNames } from "../src/icons.js";
import { dataConfig } from "../dist/data-config.js";
import { readBuiltData } from "./data-files.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const screenshots = path.join(dist, "ui-check");
await mkdir(screenshots, { recursive: true });
const manifest = await readBuiltData(path.join(dist, dataConfig.manifestPath), dataConfig);
const knowledgeCatalog = (await readBuiltData(path.join(dist, manifest.knowledgePath), dataConfig)).filter((article) => article.locale === "vi");
const knowledge = knowledgeCatalog.filter((article) => article.format !== "pdf-lessons-v1");
const locations = await readBuiltData(path.join(dist, manifest.locationsPath), dataConfig);
const knowledgeOnly = process.argv.includes("--knowledge");
const autoAdvanceOnly = process.argv.includes("--auto-advance");
const imagesOnly = process.argv.includes("--images");
const controlsOnly = process.argv.includes("--controls");
const locationsOnly = process.argv.includes("--locations");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
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
    const selectors = ".topbar-inner,.nav-tabs,.language-options,.language-trigger,.exam-section-head,.exam-shortcuts,.question-nav,.question-panel,.question-dots,.question-topline,.question-footer,.question-pager,.choice-item,.answer-actions,.exam-card,.article-row,.article-summary,.knowledge-list,.answer-button,.article-view,.article-body,.locations-list";
    for (const element of document.querySelectorAll(selectors)) {
      if (!element.getClientRects().length) continue;
      if (element.scrollWidth > element.clientWidth + 1) problems.push(`${element.className} overflows internally`);
    }
    const nav = document.querySelector(".question-nav")?.getBoundingClientRect();
    const panel = document.querySelector(".question-panel")?.getBoundingClientRect();
    if (nav?.width && panel) {
      if (innerWidth >= 768 && nav.right > panel.left) problems.push("Persistent question sidebar overlaps question panel");
      if (innerWidth < 768 && (nav.left < panel.left || nav.right > panel.right)) problems.push("Question drawer escapes question panel");
    }
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

async function checkPracticeControls(page, locale, submitted = false) {
  if (!submitted) assert.equal(await page.locator(".answer-button .ui-icon").count(), 0, "Answer icons appear only during review");
  if (submitted) {
    assert.ok(await page.locator(".answer-button.correct").evaluateAll((buttons) => buttons.every((button) => getComputedStyle(button).backgroundColor === "rgb(167, 243, 208)")), "Correct answers use the stronger green");
    assert.equal(await page.locator(".result-legend").count(), 1, "Review includes an answer-state legend");
    assert.ok(await page.locator(".answer-status").count() >= 1, "Reviewed answers include explicit text status");
  }
  assert.equal(await page.locator(".question-topline [data-back-exams]").count(), 1);
  assert.equal(await page.locator(".question-footer button").count(), 3);
  assert.equal(await page.locator(".question-footer [data-back-exams]").count(), 0);
  for (const [attribute, label] of [["data-back-exams", "examList"], ["data-prev-question", "previous"], ["data-next-question", "next"]]) {
    const button = page.locator(`[${attribute}]`);
    assert.equal(await button.getAttribute("aria-label"), translate(locale, label));
    assert.equal(await button.getAttribute("data-tooltip"), translate(locale, label));
    assert.equal(await button.locator(".ui-icon").count(), 1);
  }
  assert.equal(await page.locator("[data-submit-exam] span").textContent(), translate(locale, submitted ? "resubmit" : "submit"));
  const smallTargets = await page.locator(".question-panel button").evaluateAll((buttons) => buttons.filter((button) => {
    if (!button.getClientRects().length) return false;
    const rect = button.getBoundingClientRect();
    return rect.width < 43.9 || rect.height < 43.9;
  }).map((button) => button.outerHTML));
  assert.deepEqual(smallTargets, [], "Compact controls must preserve 44px touch targets");
  await page.keyboard.press("Tab");
  await page.locator("[data-back-exams]").focus();
  assert.equal(await page.locator("[data-back-exams]").evaluate((button) => getComputedStyle(button, "::after").visibility), "visible");
}

async function checkControlsWorkflow(page, width, locale) {
  await page.locator(".exam-card.honmen").first().click();
  await page.waitForSelector(".question-title");
  await checkPracticeControls(page, locale);
  assert.equal(await page.locator("[data-prev-question]").isDisabled(), true);
  await page.locator("[data-next-question]").click();
  await waitForQuestion(page, 1);
  assert.equal(await page.locator("[data-prev-question]").isDisabled(), false);
  await page.locator("[data-prev-question]").click();
  await waitForQuestion(page, 0);
  await openQuestionList(page);
  await goQuestion(page, 90);
  await checkPracticeControls(page, locale);
  await checkQuestionImages(page, `${width}/${locale}/compact-compound`);
  await chooseAnswer(page, 1, false);
  await page.waitForTimeout(300);
  const selected = page.locator('[data-choice-answer="1:false"]');
  if (!(await selected.isVisible())) await page.locator('[data-choice-step="0"]').click();
  assert.equal(await selected.getAttribute("aria-pressed"), "true");
  await selected.hover();
  await page.waitForTimeout(170);
  assert.deepEqual(await selected.evaluate((button) => ({ color: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor })), { color: "rgb(255, 255, 255)", background: "rgb(169, 27, 96)" });
  await checkLayout(page, `${width}/${locale}/compact-controls`);
  if ((width === 390 || width === 1440) && locale === "vi") {
    await page.mouse.move(0, 0);
    await page.locator(".choice-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshots, `${width}-compact-compound.png`), fullPage: true });
  }
  const lastIndex = (await page.locator(".dot").count()) - 1;
  await goQuestion(page, lastIndex);
  assert.equal(await page.locator("[data-next-question]").isDisabled(), true);
  await page.locator("[data-submit-exam]").click();
  await checkPracticeControls(page, locale, true);
  await checkLayout(page, `${width}/${locale}/compact-review`);
  await page.locator("[data-back-exams]").click();
  await page.waitForSelector(".exam-card");
}

async function openQuestionList(page) {
  if (!(await page.locator(".question-nav").isVisible())) await page.locator("[data-toggle-questions]").click();
}

async function goQuestion(page, index) {
  await openQuestionList(page);
  await page.locator(`[data-go-question="${index}"]`).click();
}

async function chooseAnswer(page, number, value) {
  await page.waitForSelector('.question-body[data-layout-ready="true"]');
  const button = page.locator(`[data-choice-answer="${number}:${value}"]`);
  if (!(await button.isVisible())) await page.locator(`[data-choice-step="${number - 1}"]`).click();
  await button.click();
  await page.waitForTimeout(300);
}

async function selectLanguage(page, locale) {
  if (await page.locator(".practice-menu").count()) {
    if (!(await page.locator(".practice-menu").evaluate((el) => el.open))) await page.locator(".practice-menu > summary").click();
  }
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
    return { width: rect.width, height: rect.height, containerWidth: container.width, containerHeight: container.height, centered: Math.abs((rect.left + rect.right) / 2 - (container.left + container.right) / 2), below: title.top >= rect.bottom, fit: getComputedStyle(img).objectFit };
  }));
  assert.ok(checks.length > 0, name);
  assert.ok(checks.every((item) => item.width > 0 && item.height >= 95 && item.width <= item.containerWidth + 1 && item.height <= item.containerHeight + 1 && item.centered < 1 && item.below && item.fit === "contain"), `${name}: images must fit their viewport budget, centered, uncropped and above the question`);
  await checkLayout(page, name);
}

async function checkImageWorkflow(page, width, locale) {
  for (const type of ["karimen", "honmen", "gentsuki"]) {
    const item = manifest.exams.find((exam) => exam.type === type);
    const exam = await readBuiltData(path.join(dist, item.path), dataConfig);
    const index = exam.questions.findIndex((q, index) => index > 0 && q.imagePaths.length && !exam.questions[index - 1].choices.length);
    assert.ok(index > 0);
    await page.locator(`.exam-card.${type}`).first().click();
    await page.waitForSelector(".question-title");
    await openQuestionList(page);
    await goQuestion(page, index - 1);
    await page.locator('[data-answer="true"]').click();
    await waitForQuestion(page, index);
    await checkQuestionImages(page, `${width}/${locale}/${type}/image-after-advance`);
    await page.waitForFunction(() => document.activeElement === document.querySelector(".question-title"));
    const visible = await page.locator(".question-images").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const header = document.querySelector(".topbar");
      return rect.top < innerHeight && rect.bottom > 0 && rect.top >= (header && getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().bottom : 0) - 1;
    });
    assert.equal(visible, true, "Automatic progression skipped the question image");
    const compoundIndex = exam.questions.findIndex((q) => q.choices.length && q.imagePaths.length);
    if (compoundIndex >= 0) {
      await goQuestion(page, compoundIndex);
      await checkQuestionImages(page, `${width}/${locale}/${type}/illustration`);
    }
    if ((width === 390 || width === 1440) && locale === "vi") {
      await page.locator(".question-images").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshots, `${width}-${type}-large-image.png`), fullPage: true });
    }
    await page.locator("[data-back-exams]").click();
  }
}

async function checkSlowImageWorkflow(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 } });
  const page = await context.newPage();
  try {
    await page.route(/\/data\/(?:assets|enhanced-exams)\//, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    await page.goto(base);
    await page.locator(".exam-card.honmen").first().click();
    await page.waitForSelector(".question-title");
    await openQuestionList(page);
    await goQuestion(page, 89);
    await page.locator('[data-answer="true"]').click();
    await waitForQuestion(page, 90);
    await page.waitForFunction(() => document.activeElement === document.querySelector(".question-title"));
    await checkQuestionImages(page, `${width}/slow-image-load`);
    assert.equal(await page.locator(".question-images img").first().evaluate((image) => {
      const header = document.querySelector(".topbar");
      return image.getBoundingClientRect().top >= (header && getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().bottom : 0) - 1;
    }), true, "Image scrolled out of view after a delayed load");
    const item = manifest.exams.find((exam) => exam.type === "honmen");
    const exam = await readBuiltData(path.join(dist, item.path), dataConfig);
    const otherIndex = exam.questions.findIndex((q, index) => index > 0 && index !== 90 && q.imagePaths.length && !exam.questions[index - 1].choices.length);
    await goQuestion(page, otherIndex - 1);
    await page.locator('[data-answer="true"]').click();
    await waitForQuestion(page, otherIndex);
    await goQuestion(page, 0);
    await page.locator("[data-next-question]").focus();
    const scroll = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(650);
    assert.equal(await page.locator(".dot.current").getAttribute("data-go-question"), "0");
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute("data-next-question")), true, "Delayed image completion stole focus after manual navigation");
    assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - scroll) < 2);
  } finally {
    await context.close();
  }
}

async function checkAutoAdvance(page, width, locale) {
  for (const type of ["karimen", "honmen", "gentsuki"]) {
    const item = manifest.exams.find((exam) => exam.type === type);
    const exam = await readBuiltData(path.join(dist, item.path), dataConfig);
    await page.locator(`.exam-card.${type}`).first().click();
    await page.waitForSelector(".question-title");
    await page.locator('[data-answer="true"]').dblclick({ delay: 50 });
    await waitForQuestion(page, 1);
    assert.equal(await page.locator('[data-go-question="0"]').evaluate((el) => el.classList.contains("answered")), true);
    assert.equal(await page.locator('[data-go-question="1"]').evaluate((el) => el.classList.contains("answered")), false, "Double-click answered the next question");
    const framing = await page.locator(".question-title").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const header = document.querySelector(".topbar");
      return { focused: document.activeElement === el, top: rect.top, headerBottom: header && getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().bottom : 0 };
    });
    assert.equal(framing.focused, true);
    assert.ok(framing.top >= framing.headerBottom - 1, "Next question is hidden beneath the header");
    await goQuestion(page, 0);
    assert.equal(await page.locator('[data-answer="true"]').getAttribute("class"), "answer-button selected");
    await page.locator('[data-answer="false"]').click();
    await waitForQuestion(page, 1);
    let choiceQuestion = null;
    if (type === "honmen") {
      const index = exam.questions.findIndex((q) => q.choices.length);
      choiceQuestion = exam.questions[index];
      await goQuestion(page, index);
      await chooseAnswer(page, choiceQuestion.choices[0].number, false);
      await page.waitForTimeout(350);
      assert.equal(await page.locator(".dot.current").getAttribute("data-go-question"), String(index));
      assert.equal(await page.locator(`[data-go-question="${index}"]`).evaluate((el) => el.classList.contains("answered")), false, "Partial question marked complete");
      const alternative = locale === "en" ? "ja" : "en";
      await selectLanguage(page, alternative);
      assert.equal(await page.locator(`[data-choice-answer="${choiceQuestion.choices[0].number}:false"]`).getAttribute("class"), "answer-button selected");
      await selectLanguage(page, locale);
      for (const choice of choiceQuestion.choices.slice(1)) {
        await chooseAnswer(page, choice.number, false);
      }
      await waitForQuestion(page, index + 1);
      assert.equal(await page.locator(`[data-go-question="${index}"]`).evaluate((el) => el.classList.contains("answered")), true, "All-false choices did not complete the question");
    }
    const last = exam.questions.at(-1);
    const lastIndex = exam.questions.length - 1;
    await goQuestion(page, lastIndex);
    if (last.choices.length) {
      for (const choice of last.choices) await chooseAnswer(page, choice.number, choice.correct);
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
    await goQuestion(page, 0);
    await page.locator('[data-answer="true"]').click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator(".dot.current").getAttribute("data-go-question"), "0", "Review answer advanced automatically");
    await checkLayout(page, `${width}/${locale}/${type}/auto-advance`);
    await page.locator("[data-back-exams]").click();
  }
  if (locale === "vi") {
    await page.locator(".exam-card.karimen").first().click();
    await page.waitForSelector(".question-title");
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
  await page.locator("[data-knowledge-language]").selectOption("vi");
  assert.equal(await page.locator(".article-row").count(), knowledgeCatalog.length);
  if (locale !== "vi") assert.equal(await page.locator(".content-language").count(), 1);
  const dimensions = await page.locator(".article-row").evaluateAll((rows) => rows.map((row) => ({ row: row.getBoundingClientRect().width, list: row.parentElement.clientWidth })));
  assert.ok(dimensions.every(({ row, list }) => Math.abs(row - list) < 1), "Article rows must occupy the entire list width");
  await checkLayout(page, `${width}/${locale}/knowledge`);
  const search = page.locator("[data-knowledge-search]");
  await search.fill("bien bao");
  assert.equal(await page.locator('[data-open-article="vi-knowledge-traffic-signs"]').count(), 1);
  assert.ok(await page.locator(".article-row").count() < knowledgeCatalog.length);
  await search.fill("zzzz-no-match");
  assert.equal(await page.locator(".empty-state").count(), 1);
  await search.fill("");
  assert.equal(await page.locator(".article-row").count(), knowledgeCatalog.length);
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
      const signs = article.tables.flatMap((table) => table.rows.filter((row) => row.length === 2));
      const entries = await page.locator(".sign-entry").evaluateAll((items) => items.map((entry) => ({
        rows: entry.querySelectorAll("tr").length,
        headingCells: entry.querySelectorAll(".sign-heading > *").length,
        title: entry.querySelector(".sign-title").textContent,
        description: entry.querySelector(".sign-description td").textContent,
        rowspan: entry.querySelector(".sign-image-cell").rowSpan,
        colspan: entry.querySelector(".sign-description td").colSpan,
      })));
      assert.deepEqual(entries, signs.map(([sign, description]) => ({ rows: 2, headingCells: 2, title: sign.text, description: description.text, rowspan: 2, colspan: 1 })));
      const signLayout = await page.locator(".traffic-sign-table").evaluate((table) => {
        const entry = table.querySelector(".sign-entry");
        const image = entry.querySelector(".sign-image-cell").getBoundingClientRect();
        const title = entry.querySelector(".sign-title").getBoundingClientRect();
        const description = entry.querySelector(".sign-description td").getBoundingClientRect();
        return {
          horizontalScroll: table.parentElement.scrollWidth > table.parentElement.clientWidth + 1,
          imageFirst: image.right <= title.left + 1,
          descriptionBelow: description.top >= title.bottom - 1,
          imageSpansBoth: Math.abs(image.top - title.top) < 1 && Math.abs(image.bottom - description.bottom) < 1,
          alignedText: Math.abs(description.left - title.left) < 1 && Math.abs(description.width - title.width) < 1,
          divider: getComputedStyle(entry.querySelector(".sign-title"), "::after").height,
        };
      });
      assert.deepEqual(signLayout, { horizontalScroll: false, imageFirst: true, descriptionBelow: true, imageSpansBoth: true, alignedText: true, divider: "1px" });
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

async function checkLocations(page, width, locale) {
  await page.locator('[data-tab="locations"]').click();
  await page.waitForSelector(".location-row");
  const search = page.locator("[data-location-search]");
  await search.fill("");
  assert.equal(await page.locator(".location-row").count(), locations.length);
  await search.evaluate((input) => { input.dataset.testIdentity = "original-input"; });
  await search.pressSequentially("Tokyo", { delay: 20 });
  assert.equal(await search.inputValue(), "Tokyo", "Typing reversed the search query");
  assert.equal(await search.getAttribute("data-test-identity"), "original-input", "Search input was replaced");
  assert.equal(await search.evaluate((input) => input.selectionStart), 5);
  assert.equal(await page.locator(".location-row").count(), locations.filter((item) => JSON.stringify(item).toLowerCase().includes("tokyo")).length);
  await search.evaluate((input) => input.setSelectionRange(2, 4));
  await search.press("Backspace");
  assert.equal(await search.inputValue(), "Too");
  await search.pressSequentially("ky", { delay: 20 });
  assert.equal(await search.inputValue(), "Tokyo", "Editing in the middle moved the cursor");
  assert.equal(await search.evaluate((input) => input.selectionStart), 4);
  await search.fill("");
  const composedQuery = locations[0].prefecture.ja;
  await search.evaluate((input, text) => {
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.value = text;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertCompositionText", isComposing: true }));
  }, composedQuery);
  assert.equal(await page.locator(".location-row").count(), locations.length, "Filtering interrupted composition");
  await search.evaluate((input, text) => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text })), composedQuery);
  assert.equal(await search.inputValue(), composedQuery);
  assert.equal(await search.getAttribute("data-test-identity"), "original-input");
  assert.equal(await search.evaluate((input) => input === document.activeElement), true);
  assert.equal(await page.locator(".location-row").count(), locations.filter((item) => JSON.stringify(item).toLowerCase().includes(composedQuery.toLowerCase())).length);
  await search.fill("");
  await search.pressSequentially("zzzz-no-match");
  assert.equal(await search.inputValue(), "zzzz-no-match");
  assert.equal(await page.locator(".empty-state").count(), 1);
  await search.fill("");
  assert.equal(await page.locator(".location-row").count(), locations.length);
  await checkLayout(page, `${width}/${locale}/location-search`);
}

try {
  for (const name of iconNames) {
    const response = await fetch(`${base}/assets/icons/${name}.svg`);
    assert.equal(response.status, 200, `Missing icon: ${name}`);
    assert.ok(response.headers.get("content-type").includes("image/svg+xml"));
    assert.ok((await response.text()).includes("<svg"), `Invalid icon: ${name}`);
  }
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
        if (locale === "vi" && (width === 390 || width === 1440)) await checkSlowImageWorkflow(width);
        checks += 3;
        continue;
      }
      if (controlsOnly) {
        await checkControlsWorkflow(page, width, locale);
        checks++;
        continue;
      }
      if (locationsOnly) {
        await checkLocations(page, width, locale);
        checks++;
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
        const exam = await readBuiltData(path.join(dist, item.path), dataConfig);
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
        await checkPracticeControls(page, locale);
        await checkLayout(page, `${width}/${locale}/${type}`);
        await page.locator("[data-close-questions]").click();
        await page.locator('[data-answer="true"]').click();
        await waitForQuestion(page, 1);
        await goQuestion(page, 0);
        const alternative = locale === "en" ? "ja" : "en";
        const timerBefore = await page.locator(".timer").textContent();
        await selectLanguage(page, alternative);
        assert.equal(await page.locator('[data-answer="true"]').getAttribute("class"), "answer-button selected");
        assert.ok((await page.locator(".question-title").textContent()).includes(exam.questions[0].textAll[alternative]));
        const seconds = (time) => time.split(":").reduce((m, n) => m * 60 + Number(n), 0);
        assert.ok(seconds(await page.locator(".timer").textContent()) <= seconds(timerBefore));
        await selectLanguage(page, locale);
        const imageIndex = exam.questions.findIndex((q) => q.imagePaths.length && (type !== "honmen" || q.choices.length));
        await goQuestion(page, imageIndex);
        const images = page.locator(".question-images img");
        await images.first().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll(".question-images img")].every((img) => img.complete && img.naturalWidth > 0));
        await checkQuestionImages(page, `${width}/${locale}/${type}/image-layout`);
        if (type === "honmen") {
          const question = exam.questions[imageIndex];
          assert.equal(await page.locator(".choice-text").first().textContent(), question.choices[0].textAll[locale]);
          await chooseAnswer(page, 1, true);
          const navScroll = await page.locator(".question-list").evaluate((el) => el.scrollTop);
          await selectLanguage(page, alternative);
          assert.equal(await page.locator(".question-list").evaluate((el) => el.scrollTop), navScroll);
          assert.equal(await page.locator('[data-choice-answer="1:true"]').getAttribute("class"), "answer-button selected");
          assert.equal(await page.locator(".choice-text").first().textContent(), question.choices[0].textAll[alternative]);
          await selectLanguage(page, locale);
        }
        await checkLayout(page, `${width}/${locale}/${type}/image`);
        const explanationIndex = exam.questions.findIndex((q) => q.explanationAll[locale]);
        if (explanationIndex >= 0) await goQuestion(page, explanationIndex);
        await page.locator("[data-submit-exam]").click();
        await checkPracticeControls(page, locale, true);
        const points = (q) => type === "honmen" ? (q.number >= 91 ? 2 : 1) : 2;
        const expectedScore = exam.questions[0].correct === true ? points(exam.questions[0]) : 0;
        const total = exam.questions.reduce((sum, q) => sum + points(q), 0);
        assert.equal(await page.locator(".result-score").textContent(), `${expectedScore}/${total}`);
        if (explanationIndex >= 0) {
          assert.ok((await page.locator(".explanation").textContent()).includes(exam.questions[explanationIndex].explanationAll[locale]));
        }
        await checkLayout(page, `${width}/${locale}/${type}/result`);
        if ((width === 390 || width === 1440) && (locale === "vi" || locale === "pt")) {
          await goQuestion(page, 0);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: path.join(screenshots, `${width}-${locale}-${type}.png`), fullPage: true });
        }
        await page.locator("[data-back-exams]").click();
        checks++;
      }
      await checkKnowledge(page, width, locale);
      await checkLocations(page, width, locale);
      await page.locator('[data-tab="exams"]').click();
      await page.reload();
      await page.waitForSelector(".exam-card");
      assert.equal(await page.locator(".language-trigger span").textContent(), languages[locale]);
    }
    assert.deepEqual(pageErrors, [], `Browser errors at width ${width}`);
    await context.close();
    console.log(`OK: ${width}px, all ${manifest.locales.length} languages, ${knowledgeOnly ? "knowledge list, search and article content" : autoAdvanceOnly ? "automatic progression, last question, review and cancellation" : imagesOnly ? "large centered images before question text and automatic progression" : controlsOnly ? "compact controls, icons, labels, touch targets and review" : locationsOnly ? "location search, typing order, cursor, selection and IME composition" : "all exam types, knowledge and locations"}`);
  }
  console.log(`Passed ${checks} ${knowledgeOnly ? "knowledge" : autoAdvanceOnly ? "auto-advance" : imagesOnly ? "image" : controlsOnly ? "control" : locationsOnly ? "location-search" : "exam"} workflows. Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
