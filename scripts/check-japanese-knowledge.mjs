import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { dataConfig } from "../dist/data-config.js";
import { readBuiltData } from "./data-files.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const locale = process.argv.includes("--vi") ? "vi" : "ja";
const articleId = (slug) => `${locale}-kyousoku-${slug}`;
const screenshots = path.join(root, `output/${locale === "vi" ? "vietnamese" : "japanese"}-knowledge`);
await mkdir(screenshots, { recursive: true });
const manifest = await readBuiltData(path.join(dist, dataConfig.manifestPath), dataConfig);
const knowledge = await readBuiltData(path.join(dist, manifest.knowledgePath), dataConfig);
const articles = knowledge.filter((article) => article.locale === locale && article.format === "pdf-lessons-v1");
const source = JSON.parse(await readFile(path.join(root, "data/knowledge-ja/lessons.json"), "utf8"));
assert.equal(articles.length, source.articles.length);
assert.equal(manifest.knowledgeFallbackLocale, "ja");
const activeColors = JSON.parse(await readFile(path.join(root, "data/knowledge-ja/color-applied-manifest.json"), "utf8"));
assert.deepEqual(manifest.knowledgeSources.ja, source.source);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff": "font/woff" };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.join(dist, pathname === "/" ? "index.html" : decodeURIComponent(pathname));
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
let workflows = 0;

async function layout(page, name) {
  const issues = await page.evaluate(() => {
    const result = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) result.push("Page overflows horizontally");
    for (const element of document.querySelectorAll(".knowledge-toolbar,.knowledge-list,.article-row,.pdf-lesson-header,.pdf-reading-layout,.pdf-lesson-body,.pdf-pager,.pdf-outline,.pdf-text,.pdf-pager-button")) {
      if (!element.getClientRects().length) continue;
      if (element.scrollWidth > element.clientWidth + 1) result.push(`${element.className} overflows`);
    }
    for (const button of document.querySelectorAll(".pdf-article-view button,.knowledge-toolbar select")) {
      if (!button.getClientRects().length) continue;
      const rect = button.getBoundingClientRect();
      if (rect.width < 43.9 || rect.height < 43.9) result.push("Small touch target");
    }
    return result;
  });
  assert.deepEqual(issues, [], name);
}

function visibleTextBlocks(article) {
  return article.blocks.filter((block) => block.kind === "text" && !(block.tag === "h2" && block.text.trim() === article.title.trim()));
}

try {
  browser = await chromium.launch();
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForSelector(".exam-card");
    await page.locator('[data-tab="knowledge"]').click();
    await page.waitForSelector(".article-row");
    await page.locator("[data-knowledge-language]").selectOption(locale);
    if (locale === "vi") {
      assert.equal(await page.locator("[data-knowledge-scope]").inputValue(), "quick");
      await page.locator("[data-knowledge-scope]").selectOption("detail");
    }
    assert.equal(await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('18px "Mirai Knowledge JP"');
    }), true, "Bundled Japanese font failed to load");
    assert.equal(await page.locator("[data-knowledge-language]").inputValue(), locale);
    const catalogSize = locale === "vi"
      ? knowledge.filter((article) => article.locale === "vi" && (article.format === "pdf-lessons-v1" || article.currentLaw)).length
      : manifest.stats.knowledgeByLocale[locale];
    assert.equal(await page.locator(".article-row").count(), catalogSize);
    await layout(page, `${width}/list`);
    if (width !== 320) await page.screenshot({ path: path.join(screenshots, `${width}-list.png`) });
    const search = page.locator("[data-knowledge-search]");
    await search.evaluate((input) => { input.dataset.originalInput = "yes"; });
    await search.pressSequentially("abc");
    assert.equal(await search.inputValue(), "abc");
    assert.equal(await search.getAttribute("data-original-input"), "yes");
    await search.fill("");
    const query = articles.find((article) => article.slug === "chapter-05-section-08").title;
    await search.evaluate((input, text) => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.value = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText", data: text }));
    }, query);
    assert.equal(await page.locator(".article-row").count(), catalogSize);
    await search.evaluate((input, text) => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text })), query);
    assert.equal(await page.locator(`[data-open-article="${articleId("chapter-05-section-08")}"]`).count(), 1);
    assert.equal(await search.getAttribute("data-original-input"), "yes");
    await search.fill("");
    await page.locator("[data-knowledge-group]").selectOption("chapter-05");
    assert.equal(await page.locator(".article-row").count(), articles.filter((article) => article.group.id === "chapter-05").length);
    await page.locator("[data-knowledge-group]").selectOption("");
    const loadedImages = new Set();
    const loadedColors = new Set();
    for (const article of articles) {
      await page.locator(`[data-open-article="${article.id}"]`).click();
      assert.equal(await page.locator(".article-view h1").textContent(), article.title);
      assert.equal(await page.locator(".article-view").getAttribute("lang"), locale);
      const text = await page.locator(".pdf-lesson-body > .pdf-text").evaluateAll((elements) => elements.map((element) => {
        const copy = element.cloneNode(true);
        copy.querySelectorAll("rt,rp").forEach((node) => node.remove());
        return copy.textContent;
      }));
      assert.deepEqual(text, visibleTextBlocks(article).map((block) => block.text), `${article.id}: changed body text`);
      const tables = article.blocks.filter((block) => block.kind === "table");
      assert.equal(await page.locator(".pdf-table").count(), tables.length);
      for (let index = 0; index < tables.length; index += 1) {
        const cells = await page.locator(".pdf-table").nth(index).locator("th,td").evaluateAll((elements) => elements.map((cell) => ({
          rowspan: cell.rowSpan, colspan: cell.colSpan,
          text: [...cell.querySelectorAll(".pdf-cell-text")].map((paragraph) => {
            const copy = paragraph.cloneNode(true);
            copy.querySelectorAll("rt,rp").forEach((node) => node.remove());
            return copy.textContent;
          }),
        })));
        assert.deepEqual(cells, tables[index].cells.map((cell) => ({ rowspan: cell.rowspan, colspan: cell.colspan, text: cell.content.filter((entry) => entry.kind === "text").map((entry) => cell.paragraphs[entry.index].text) })), `${article.id}: changed table contents`);
        const contents = await page.locator(".pdf-table").nth(index).locator("th,td").evaluateAll((cells) => cells.map((cell) => [...cell.children].filter((node) => node.matches(".pdf-cell-text,.pdf-image-button")).map((node) => node.matches(".pdf-cell-text") ? { kind: "text", text: node.textContent } : { kind: "image", id: node.querySelector("img").dataset.pdfImage })));
        const expected = tables[index].cells.map((cell) => cell.content.map((entry) => entry.kind === "image" ? { kind: "image", id: cell.images[entry.index].id } : { kind: "text", text: cell.paragraphs[entry.index].runs.map((run) => run.reading ? `${run.text}(${run.reading})` : run.text).join("") }));
        assert.deepEqual(contents, expected, `${article.id}: illustrations/captions reordered`);
      }
      const expectedImages = article.blocks.flatMap((block) => block.kind === "figure" ? [block.image.id] : block.kind === "table" ? block.cells.flatMap((cell) => cell.images.map((image) => image.id)) : []);
      const actualImages = await page.locator("[data-pdf-image]").evaluateAll((images) => images.map((image) => { image.loading = "eager"; return image.dataset.pdfImage; }));
      assert.deepEqual(actualImages, expectedImages);
      await page.waitForFunction(() => [...document.querySelectorAll("[data-pdf-image]")].every((image) => image.complete && image.naturalWidth > 0));
      const blank = await page.locator("[data-pdf-image]").evaluateAll((images) => images.filter((image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 0 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 220) return false;
        return true;
      }).map((image) => image.dataset.pdfImage));
      assert.deepEqual(blank, [], `${article.id}: blank illustration`);
      const colorCheck = await page.locator("[data-pdf-color]").evaluateAll((images) => images.map((image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let colored = 0;
        for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 35) colored += 1;
        return { id: image.dataset.pdfImage, valid: image.getAttribute("src") === `data/${image.dataset.pdfColor}` && image.naturalWidth > 0, colored };
      }));
      assert.ok(colorCheck.every((image) => image.valid), `${article.id}: wrong reference source`);
      colorCheck.forEach((image) => loadedColors.add(image.id));
      const references = await page.locator("[data-pdf-reference]").evaluateAll((elements) => elements.map((element) => ({
        target: element.dataset.pdfReference,
        text: [...element.querySelectorAll("div > p")].map((paragraph) => {
          const copy = paragraph.cloneNode(true);
          copy.querySelectorAll("rt,rp").forEach((node) => node.remove());
          return copy.textContent;
        }),
      })));
      assert.deepEqual(references, tables.flatMap((table) => table.cells.filter((cell) => cell.reference).map((cell) => ({ target: cell.reference, text: table.cells.find((other) => other.id === cell.reference).paragraphs.filter((p) => p.text.trim()).map((p) => p.text) }))));
      actualImages.forEach((id) => loadedImages.add(id));
      await layout(page, `${width}/${article.id}`);
      if (article.id === articleId("chapter-01-section-01") || article.id === articleId("appendix-3-part-1")) {
        if (width !== 320) await page.screenshot({ path: path.join(screenshots, `${width}-${article.slug}.png`) });
      }
      if (tables.length && article.id === articleId("appendix-3-part-1")) {
        const mode = page.locator("[data-pdf-image-mode]");
        await mode.selectOption("original");
        await page.waitForFunction(() => [...document.querySelectorAll("[data-pdf-color]")].every((image) => image.complete && image.naturalWidth > 0 && image.getAttribute("src") === `data/${image.dataset.pdfOriginal}`));
        await mode.selectOption("color");
        await page.waitForFunction(() => [...document.querySelectorAll("[data-pdf-color]")].every((image) => image.complete && image.naturalWidth > 0 && image.getAttribute("src") === `data/${image.dataset.pdfColor}`));
        const reference = page.locator("[data-pdf-reference]").first();
        await reference.locator("summary").click();
        assert.equal(await reference.getAttribute("open"), "");
        await layout(page, `${width}/expanded-ditto`);
        await reference.locator("summary").click();
        await page.locator("[data-pdf-image]").first().click();
        await page.waitForSelector(".pdf-image-dialog[open]");
        await page.waitForFunction(() => document.querySelector(".pdf-image-dialog img").complete && document.querySelector(".pdf-image-dialog img").naturalWidth > 0);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".pdf-image-dialog").getAttribute("open"), null);
        assert.equal(await page.locator("[data-pdf-image]").first().evaluate((image) => image.parentElement === document.activeElement), true);
        await page.locator(".pdf-original-table > summary").first().click();
        await page.locator("[data-pdf-source-table]").first().click();
        await page.waitForSelector(".pdf-image-dialog[open]");
        await page.locator(".pdf-image-dialog button").click();
        // A genuine failed request must display the untouched image, including
        // its enlarged view, without changing any other sign's source.
        const first = page.locator("[data-pdf-color]").first();
        const originalPath = await first.getAttribute("data-pdf-original");
        const colorPath = await first.getAttribute("data-pdf-color");
        const pattern = `**/data/${colorPath}*`;
        await page.route(pattern, (route) => route.fulfill({ status: 404, body: "not found" }));
        await first.evaluate((image) => { image.src = `data/${image.dataset.pdfColor}?failed-request-test`; });
        await page.waitForFunction((path) => document.querySelector("[data-pdf-color]").getAttribute("src") === `data/${path}` && document.querySelector("[data-pdf-color]").complete, originalPath);
        assert.equal(await first.evaluate((image) => image.parentElement.dataset.pdfEnlarge), originalPath);
        await first.click();
        await page.waitForSelector(".pdf-image-dialog[open]");
        assert.equal(await page.locator(".pdf-image-dialog img").getAttribute("src"), `data/${originalPath}`);
        await page.keyboard.press("Escape");
        await page.unroute(pattern);
      }
      await page.locator("[data-close-article]").click();
      workflows += 1;
    }
    assert.equal(loadedImages.size, 277);
    assert.equal(loadedColors.size, activeColors.images.length);
    await page.locator(`[data-open-article="${articleId("chapter-01-section-01")}"]`).click();
    const next = articles[articles.findIndex((article) => article.id === articleId("chapter-01-section-01")) + 1];
    await page.locator(`[data-pdf-article="${next.id}"]`).click();
    assert.equal(await page.locator(".article-view h1").textContent(), next.title);
    await page.locator("[data-close-article]").click();
    await page.locator("[data-knowledge-language]").selectOption("vi");
    await page.locator("[data-knowledge-scope]").selectOption("quick");
    await page.locator('[data-open-article="vi-quick-motorcycles"]').click();
    assert.equal(await page.locator(".quick-related-group").count(), 3);
    const relatedHeadings = await page.locator(".quick-related-group h3").allTextContents();
    assert.ok(relatedHeadings.some((heading) => heading.includes("Chương 3")));
    assert.ok(relatedHeadings.some((heading) => heading.includes("Chương 8")));
    assert.ok(relatedHeadings.some((heading) => heading.includes("Quy định cập nhật")));
    await page.locator("[data-close-article]").click();
    await page.locator("[data-knowledge-scope]").selectOption("detail");
    await page.locator('[data-open-article="vi-kyousoku-chapter-05-section-08"]').click();
    for (const [interfaceLocale, expectedLocale] of [["ja", "ja"], ["vi", "vi"], ["en", "ja"], ["vi", "vi"]]) {
      await page.locator(".language-trigger").click();
      await page.locator(`[data-locale="${interfaceLocale}"]`).click();
      assert.equal(await page.locator(".pdf-article-view").getAttribute("lang"), expectedLocale);
      const counterpart = expectedLocale === locale ? articles.find((article) => article.slug === "chapter-05-section-08") : null;
      if (counterpart) assert.equal(await page.locator(".pdf-article-view h1").textContent(), counterpart.title);
    }
    await page.close();
    console.log(`OK: ${locale}/${width}px, all ${articles.length} lessons, exact runtime text/table contents, 277 nonblank illustrations, ${activeColors.images.length} validated references, grouped quick-review links, original/reference switching, failed-request fallback, IME, previews and navigation`);
  }
  assert.deepEqual(errors, []);
  console.log(`Passed ${workflows} ${locale} lesson workflows. Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
