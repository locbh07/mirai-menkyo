import { icon } from "./icons.js";

function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function labels(locale) {
  return locale === "vi" ? {
    enlarge: "Phóng to", original: "Bảng PDF gốc", page: "trang", table: "Bảng gốc", reference: "Tham chiếu", position: "Vị trí trong nguồn",
    previous: "Bài trước", next: "Bài tiếp", outline: "Mục lục bài học", navigate: "Chuyển bài", close: "Đóng",
    version: "PDF 2024 · Bản Việt do AI hỗ trợ · Chưa áp dụng sửa đổi mới",
    imageMode: "Hình minh họa", color: "Hình chuẩn/màu", pdf: "Ảnh PDF gốc", colorNote: "Hình tham khảo · Có thể đối chiếu ảnh gốc",
    source: "Nguồn: Cơ quan Cảnh sát Quốc gia Nhật Bản", reformatted: "Trình bày lại cho web", references: "Nguồn hình tham khảo",
  } : {
    enlarge: "拡大", original: "原文の表", page: "頁", table: "原文", reference: "参照", position: "原文の位置",
    previous: "前の学習", next: "次の学習", outline: "この学習の目次", navigate: "学習の移動", close: "閉じる",
    version: "2024年版の原文に基づく内容・新しい改正は未反映",
    imageMode: "図の表示", color: "カラー標識", pdf: "PDF 原図", colorNote: "カラー：参考図・原図との比較が可能",
    source: "出典：警察庁", reformatted: "原文をウェブ向けに再構成", references: "参考図の出典",
  };
}

export function renderPdfRuns(block) {
  return (block.runs || [{ text: block.text }]).map((run) => run.reading
    ? `<ruby>${escape(run.text)}<rp>(</rp><rt>${escape(run.reading)}</rt><rp>)</rp></ruby>` : escape(run.text)).join("");
}

function headingClass(block, locale) {
  const text = block.text.trim();
  if (locale === "vi") {
    if (/^Chương\s+\d+\b/i.test(text)) return "pdf-chapter-heading";
    if (/^Mục\s+\d+\b/i.test(text)) return "pdf-section-heading";
  } else {
    if (/^第\s*\d+\s*章/.test(text)) return "pdf-chapter-heading";
    if (/^第\s*\d+\s*節/.test(text)) return "pdf-section-heading";
  }
  return "";
}

function figure(image, label, original = true, locale = "ja") {
  label = image.alt || label;
  const path = original && image.color && imageMode() === "color" ? image.color.path : image.path;
  return `<button type="button" class="pdf-image-button ${image.color ? "pdf-color-image" : ""}" data-pdf-enlarge="${escape(path)}" data-pdf-caption="${escape(label)}" data-pdf-locale="${locale}" aria-label="${escape(label)} · ${labels(locale).enlarge}">
    <img src="data/${escape(path)}" width="${image.width}" height="${image.height}" alt="${escape(label)}" loading="lazy" ${original ? `data-pdf-image="${escape(image.id)}" data-pdf-original="${escape(image.path)}" ${image.color ? `data-pdf-color="${escape(image.color.path)}"` : ""}` : "data-pdf-source-table"} />
    <span class="pdf-image-zoom" aria-hidden="true">${icon("zoom-in")}</span>
  </button>`;
}

function table(block, locale) {
  const ui = labels(locale);
  const pages = (block.facsimiles || [{ page: block.source.page }]).map((fragment) => fragment.page);
  const label = `${ui.table} · ${pages.length > 1 ? `${pages[0]}–${pages.at(-1)}` : pages[0]} ${ui.page}`;
  const heading = block.hasHeader;
  const colorOnly = block.colorOnly || block.columns === 3 && block.cells.filter((cell) => cell.row === 0).map((cell) => cell.paragraphs.map((p) => p.text).join("").trim()).join("|") === "種類|番号|色";
  const compact = (block.layout === "signs" || colorOnly) && block.cells.every((cell) => cell.rowspan === 1 && (cell.colspan === 1 || cell.colspan === block.columns));
  return `<section class="pdf-table-section" data-pdf-table="${escape(block.id)}">
    <div class="pdf-table-scroll" role="region" aria-label="${label}" tabindex="0">
      <table class="pdf-table ${compact ? "pdf-table-compact" : ""} ${colorOnly ? "pdf-table-color-only" : ""}" style="--pdf-columns:${block.columns}">
        <caption>${label}</caption>
        <tbody>${Array.from({ length: block.rows }, (_, row) => `<tr>${block.cells.filter((cell) => cell.row === row).map((cell) => {
          const tag = heading && row === 0 ? "th" : "td";
          const title = cell.paragraphs.find((p) => p.text.trim())?.text.trim() || `${ui.table} · ${block.source.page} ${ui.page}`;
          const reference = cell.reference && block.cells.find((other) => other.id === cell.reference);
          return `<${tag} id="${escape(cell.id)}" rowspan="${cell.rowspan}" colspan="${cell.colspan}" ${tag === "th" ? 'scope="col"' : ""}>
            ${(cell.content || [...cell.paragraphs.map((_, index) => ({ kind: "text", index })), ...cell.images.map((_, index) => ({ kind: "image", index }))]).map((entry) => entry.kind === "image" ? figure(cell.images[entry.index], title, true, locale) : `<p class="pdf-cell-text">${renderPdfRuns(cell.paragraphs[entry.index])}</p>`).join("")}
            ${reference ? `<details class="pdf-cell-reference" data-pdf-reference="${escape(reference.id)}"><summary>${ui.reference} ${icon("chevron-down")}</summary><div>${reference.paragraphs.filter((p) => p.text.trim()).map((p) => `<p>${renderPdfRuns(p)}</p>`).join("")}<a href="#${escape(reference.id)}">${ui.position} ${icon("arrow-up-right")}</a></div></details>` : ""}
          </${tag}>`;
        }).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
    <details class="pdf-original-table"><summary>${ui.original}</summary>${(block.facsimiles || [block.facsimile]).map((fragment) => `<figure><figcaption>${fragment.page || block.source.page} ${ui.page}</figcaption>${figure(fragment, label, false, locale)}</figure>`).join("")}</details>
  </section>`;
}

export function renderPdfArticle(article, source, articles, backLabel) {
  const locale = article.locale || "ja";
  const ui = labels(locale);
  const blocks = article.blocks.filter((block) => !(block.kind === "text" && block.tag === "h2" && block.text.trim() === article.title.trim()));
  const headings = blocks.filter((block) => block.kind === "text" && ["h2", "h3"].includes(block.tag));
  const index = articles.indexOf(article);
  const pages = article.source.firstPage === article.source.lastPage ? `${article.source.firstPage} ${ui.page}` : `${article.source.firstPage}–${article.source.lastPage} ${ui.page}`;
  function pager(item, direction) {
    return item ? `<button class="pdf-pager-button" data-pdf-article="${escape(item.id)}">${icon(direction === "previous" ? "chevron-left" : "chevron-right")}
      <span><span class="pdf-pager-label">${direction === "previous" ? ui.previous : ui.next}</span><span lang="${locale}">${escape(item.title)}</span></span></button>` : "<span></span>";
  }
  return `<section class="article-view pdf-article-view" lang="${locale}">
    <div class="article-toolbar"><button class="button secondary" data-close-article>${icon("chevron-left")}<span>${escape(backLabel)}</span></button>
      <span>${escape(article.group.title)}</span></div>
    <header class="pdf-lesson-header"><p class="pdf-lesson-position">${index + 1} / ${articles.length} · PDF ${pages}</p>
      <h1>${escape(article.title)}</h1><p class="pdf-source-version">${ui.version}</p></header>
    ${blocks.some((block) => block.cells?.some((cell) => cell.images.some((image) => image.color))) ? `<div class="pdf-color-toolbar"><label>${ui.imageMode} <select data-pdf-image-mode><option value="color" ${imageMode() === "color" ? "selected" : ""}>${ui.color}</option><option value="original" ${imageMode() === "original" ? "selected" : ""}>${ui.pdf}</option></select></label><span>${ui.colorNote}</span></div>` : ""}
    <div class="pdf-reading-layout">
      ${headings.length ? `<aside class="pdf-outline"><details><summary>${icon("list")}<span>${ui.outline}</span></summary>
        <nav aria-label="${ui.outline}">${headings.map((block) => `<a class="${headingClass(block, locale)}" href="#${escape(block.id)}">${escape(block.text)}</a>`).join("")}</nav></details></aside>` : ""}
      <div class="article-body pdf-lesson-body">${blocks.map((block) => {
        if (block.kind === "table") return table(block, locale);
        if (block.kind === "figure") return `<figure class="pdf-figure">${figure(block.image, `PDF ${block.source.page} ${ui.page}`, true, locale)}</figure>`;
        const tag = ["h2", "h3"].includes(block.tag) ? block.tag : "p";
        return `<${tag} id="${escape(block.id)}" class="pdf-text ${headingClass(block, locale)} ${block.note ? "pdf-revision-note" : ""}" data-source-page="${block.source.page}">${renderPdfRuns(block)}</${tag}>`;
      }).join("")}
      <footer class="pdf-attribution">${ui.source}「${escape(source.title)}」 · ${ui.reformatted}<br />
        <a href="${escape(source.url)}#page=${article.source.firstPage}" target="_blank" rel="noopener noreferrer">PDF ${icon("external-link")}</a>
        ${article.colorSource ? `<br />${ui.references}: ${(article.colorSources || [article.colorSource.url]).map((url, index) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" title="${escape(decodeURI(url))}">${url.includes("commons.wikimedia.org") ? "Wikimedia Commons" : "MLIT"} ${index + 1} ${icon("external-link")}</a>`).join(" · ")}` : ""}</footer>
      <nav class="pdf-pager" aria-label="${ui.navigate}">${pager(articles[index - 1], "previous")}${pager(articles[index + 1], "next")}</nav></div>
    </div>
  </section>`;
}

function imageMode() {
  try { return localStorage.getItem("menkyo-pdf-image-mode") === "original" ? "original" : "color"; }
  catch { return "color"; }
}

export function installPdfImageViewer() {
  const dialog = document.createElement("dialog");
  dialog.className = "pdf-image-dialog";
  dialog.lang = "ja";
  dialog.setAttribute("aria-labelledby", "pdf-image-caption");
  dialog.innerHTML = `<header><p id="pdf-image-caption"></p><button class="icon-button" aria-label="閉じる" data-tooltip="閉じる">${icon("x")}</button></header><div class="pdf-image-stage"><img alt="" /></div>`;
  document.body.append(dialog);
  let previousFocus;
  dialog.querySelector("button").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); });
  document.addEventListener("change", (event) => {
    if (!event.target.matches("[data-pdf-image-mode]")) return;
    const mode = event.target.value;
    try { localStorage.setItem("menkyo-pdf-image-mode", mode); } catch { /* Optional preference storage. */ }
    for (const image of document.querySelectorAll("[data-pdf-color]")) {
      const path = mode === "color" ? image.dataset.pdfColor : image.dataset.pdfOriginal;
      image.src = `data/${path}`;
      image.parentElement.dataset.pdfEnlarge = path;
    }
  });
  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.dataset.pdfOriginal || image.getAttribute("src") === `data/${image.dataset.pdfOriginal}`) return;
    image.src = `data/${image.dataset.pdfOriginal}`;
    if (image.parentElement.matches("[data-pdf-enlarge]")) image.parentElement.dataset.pdfEnlarge = image.dataset.pdfOriginal;
  }, true);
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pdf-enlarge]");
    if (!button) return;
    previousFocus = button;
    const ui = labels(button.dataset.pdfLocale);
    dialog.lang = button.dataset.pdfLocale || "ja";
    dialog.querySelector("button").setAttribute("aria-label", ui.close);
    dialog.querySelector("button").dataset.tooltip = ui.close;
    const image = dialog.querySelector("img");
    image.src = `data/${button.dataset.pdfEnlarge}`;
    image.dataset.pdfOriginal = button.querySelector("img").dataset.pdfOriginal || "";
    image.alt = button.dataset.pdfCaption;
    dialog.querySelector("p").textContent = button.dataset.pdfCaption;
    dialog.showModal();
    dialog.querySelector("button").focus({ preventScroll: true });
  });
}
