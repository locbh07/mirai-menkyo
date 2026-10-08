(() => {
  const bundle = window.MENKYO_HANDOFF;
  const units = new Map(bundle.units.map((unit) => [unit.id, unit]));
  const images = new Map(bundle.images.map((image) => [image.id, image]));
  const translations = new Map();
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  let current = bundle.articles[0];
  function value(id, translated) { return translated && translations.get(id)?.translation || units.get(id)?.sourceText || ""; }
  function paragraph(entry, translated, tag = "p") {
    const result = translated && translations.get(entry.unitId);
    return `<${tag} class="${tag === "p" ? "paragraph" : ""} ${entry.note ? "revision" : ""} ${result?.status === "needs_review" ? "needs-review" : ""}" data-unit="${escape(entry.unitId || "")}" lang="${result?.translation ? escape(bundle.targetLocale) : "ja"}" title="${escape((result?.notes || []).join("; "))}">${escape(entry.unitId ? value(entry.unitId, translated) : entry.literal)}</${tag}>`;
  }
  function figure(id, translated) {
    const image = images.get(id);
    const asset = $("colors").checked && image.verifiedColor || image.original;
    return `<button class="image" data-image="${escape(id)}" title="${escape(value(image.altUnit, translated))}"><img src="${asset.path}" alt="${escape(value(image.altUnit, translated))}" loading="lazy" data-image-id="${id}" /></button>`;
  }
  function content(cell, translated) { return cell.content.map((entry) => entry.kind === "image" ? figure(entry.imageId, translated) : paragraph(entry, translated)).join(""); }
  function table(block, translated) {
    const prefix = translated ? "target" : "source";
    const header = block.cells.filter((cell) => cell.row === 0).map((cell) => cell.content.filter((entry) => entry.kind === "text").map((entry) => entry.unitId ? units.get(entry.unitId).sourceText : entry.literal).join("").trim()).join("|");
    const colorOnly = block.columns === 3 && header === "種類|番号|色";
    const compact = (block.layout === "signs" || colorOnly) && block.cells.every((cell) => cell.rowspan === 1 && (cell.colspan === 1 || cell.colspan === block.columns));
    return `<div class="table-scroll"><table style="--columns:${block.columns}" class="${compact ? "compact" : ""} ${colorOnly ? "color-only" : ""}"><caption>PDF ${block.sourcePages.join(", ")}</caption><tbody>${Array.from({ length: block.rows }, (_, row) => `<tr>${block.cells.filter((cell) => cell.row === row).map((cell) => {
      const tag = block.hasHeader && row === 0 ? "th" : "td";
      const reference = cell.reference && block.cells.find((cell) => cell.id === cell.reference);
      return `<${tag} id="${prefix}-${cell.id}" rowspan="${cell.rowspan}" colspan="${cell.colspan}" ${tag === "th" ? 'scope="col"' : ""}>${content(cell, translated)}${reference ? `<details class="reference"><summary><img src="assets/icons/chevron-down.svg" alt="" />Tham chiếu</summary><div>${reference.content.filter((entry) => entry.kind === "text").map((entry) => paragraph(entry, translated)).join("")}<a href="#${prefix}-${reference.id}">${escape(reference.id)}</a></div></details>` : ""}</${tag}>`;
    }).join("")}</tr>`).join("")}</tbody></table></div><details class="original"><summary>PDF</summary>${block.facsimiles.map((image) => `<figure><figcaption>${image.page}</figcaption><img src="${image.path}" alt="PDF ${image.page}" loading="lazy" /></figure>`).join("")}</details>`;
  }
  function pane(translated) {
    return `<header><p>${translated ? `${escape(bundle.targetLocale)} · Bản nháp` : "JA · Nguyên văn"} · PDF ${current.source.pages.join(", ")}</p><h1 lang="${translated && translations.get(current.titleUnit)?.translation ? bundle.targetLocale : "ja"}">${escape(value(current.titleUnit, translated))}</h1></header>${current.blocks.map((block) => {
      if (block.kind === "table") return table(block, translated);
      if (block.kind === "figure") return figure(block.imageId, translated);
      if (units.get(block.unitId)?.duplicateOf === current.titleUnit) return "";
      return paragraph(block, translated, ["h2", "h3"].includes(block.tag) ? block.tag : "p");
    }).join("")}`;
  }
  function render() {
    $("source").innerHTML = pane(false);
    $("target").innerHTML = pane(true);
    const translated = [...translations.values()].filter((entry) => entry.status === "translated").length;
    $("progress").textContent = `${translated} / ${bundle.units.length} đoạn · ${[...translations.values()].filter((entry) => entry.status === "needs_review").length} cần kiểm tra`;
  }
  function options() {
    const query = $("search").value.normalize("NFKC").toLowerCase();
    const matches = bundle.articles.filter((article) => [value(article.titleUnit, true), ...bundle.units.filter((unit) => unit.articleId === article.id).map((unit) => unit.sourceText)].join(" ").normalize("NFKC").toLowerCase().includes(query));
    $("lesson").innerHTML = matches.map((article) => `<option value="${article.id}">${bundle.articles.indexOf(article) + 1}. ${escape(value(article.titleUnit, true))}</option>`).join("");
    $("lesson").disabled = matches.length === 0;
    if (matches.length && !matches.includes(current)) { current = matches[0]; render(); }
    $("lesson").value = current.id;
  }
  $("lesson").addEventListener("change", () => { current = bundle.articles.find((article) => article.id === $("lesson").value); render(); });
  $("search").addEventListener("input", (event) => { if (!event.isComposing) options(); });
  $("search").addEventListener("compositionend", options);
  $("colors").addEventListener("change", () => {
    for (const image of document.querySelectorAll("[data-image-id]")) {
      const record = images.get(image.dataset.imageId);
      image.src = ($("colors").checked && record.verifiedColor || record.original).path;
    }
  });
  $("import").addEventListener("click", () => $("files").click());
  $("files").addEventListener("change", async () => {
    const draft = new Map(translations);
    try {
      for (const file of $("files").files) {
        const data = JSON.parse(await file.text());
        if (data.version !== 1 || data.packageId !== bundle.packageId || data.targetLocale !== bundle.targetLocale || !Array.isArray(data.translations)) throw new Error(`${file.name}: sai bộ dữ liệu/ngôn ngữ`);
        const seen = new Set();
        for (const entry of data.translations) {
          const unit = units.get(entry?.unitId);
          if (!unit || seen.has(entry.unitId) || entry.sourceHash !== unit.sourceHash) throw new Error(`${file.name}: mã đoạn hoặc nguồn không hợp lệ`);
          seen.add(entry.unitId);
          if (!["pending", "translated", "needs_review"].includes(entry.status) || !Array.isArray(entry.notes) || entry.notes.some((note) => typeof note !== "string")) throw new Error(`${file.name}: trạng thái không hợp lệ`);
          if (entry.translation !== null && (typeof entry.translation !== "string" || !entry.translation.trim())) throw new Error(`${file.name}: nội dung không hợp lệ`);
          if (entry.status === "translated" && !entry.translation || entry.status === "pending" && entry.translation !== null || entry.status === "needs_review" && !entry.notes.length) throw new Error(`${file.name}: bản dịch chưa hoàn chỉnh`);
          if (draft.has(entry.unitId) && JSON.stringify(draft.get(entry.unitId)) !== JSON.stringify(entry)) throw new Error(`${file.name}: hai bản dịch xung đột`);
          draft.set(entry.unitId, entry);
        }
      }
      translations.clear(); draft.forEach((entry, id) => translations.set(id, entry));
      $("error").hidden = true; options(); render();
    } catch (error) { $("error").textContent = error.message; $("error").hidden = false; }
    $("files").value = "";
  });
  $("reset").addEventListener("click", () => { translations.clear(); $("error").hidden = true; options(); render(); });
  const viewer = $("viewer");
  let previousFocus;
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-image]");
    if (!button) return;
    previousFocus = button;
    $("large-image").src = button.querySelector("img").src;
    $("large-image").alt = button.querySelector("img").alt;
    $("caption").textContent = button.title;
    viewer.showModal(); $("close").focus();
  });
  $("close").addEventListener("click", () => viewer.close());
  viewer.addEventListener("close", () => previousFocus?.isConnected && previousFocus.focus({ preventScroll: true }));
  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.dataset.imageId) return;
    const original = images.get(image.dataset.imageId).original.path;
    if (image.getAttribute("src") !== original) image.src = original;
  }, true);
  $("locale").textContent = `JA → ${bundle.targetLocale.toUpperCase()}`;
  options(); render();
})();
