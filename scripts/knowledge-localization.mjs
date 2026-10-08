export function localizeKnowledge(source, translation, overrides) {
  if (translation.locale !== "vi" || translation.sourceLocale !== "ja") throw new Error("Unsupported knowledge translation");
  const groups = new Map();
  for (const article of source.articles) {
    const localized = translation.articles[article.id];
    if (!localized?.title_vi?.trim()) throw new Error(`Missing title: ${article.id}`);
    if (article.title.trim() === article.group.title.trim()) groups.set(article.group.id, localized.title_vi);
    for (const block of article.blocks) if (block.kind === "text" && block.text.trim() === article.group.title.trim())
      groups.set(article.group.id, localized.units[block.id] || localized.title_vi);
  }
  return source.articles.map((article) => {
    const localized = translation.articles[article.id];
    const units = localized.units;
    const result = structuredClone(article);
    result.sourceArticleId = article.id;
    result.id = article.id.replace(/^ja-/, "vi-");
    result.locale = "vi";
    result.title = localized.title_vi;
    result.group.title = groups.get(article.group.id) || result.title;
    result.translation = { locale: "vi", origin: "user-supplied-ai-translation", sourceSha256: source.source.sha256 };
    function paragraph(block, text) {
      if (typeof text !== "string" || !text.trim()) throw new Error(`Missing translation: ${block.id || article.id}`);
      block.text = text;
      block.runs = [{ text }];
    }
    for (const block of result.blocks) {
      if (block.kind === "table") block.colorOnly = block.columns === 3 && block.cells.filter((cell) => cell.row === 0).map((cell) => cell.paragraphs.map((p) => p.text).join("").trim()).join("|") === "種類|番号|色";
      if (block.kind === "text" && block.text.trim()) {
        const sourceText = block.text;
        paragraph(block, units[block.id]);
        const replacement = overrides.textReplacements[block.id];
        if (replacement) {
          if (!block.text.includes(replacement.from)) throw new Error(`Stale editorial correction: ${block.id}`);
          paragraph(block, block.text.replace(replacement.from, replacement.to));
        }
        if (block.tag === "h2" && sourceText.trim() === article.title.trim()) paragraph(block, result.title);
      }
      for (const cell of block.cells || []) {
        const key = `${article.id}/${cell.id}`;
        const text = units[key];
        const meaningful = cell.paragraphs.map((p, index) => p.text.trim() ? index : null).filter((index) => index !== null);
        const parts = overrides.cellParagraphs[cell.id];
        if (cell.images.length > 1 && meaningful.length > 1 && !parts) throw new Error(`Image/caption alignment needs review: ${cell.id}`);
        if (parts) {
          if (JSON.stringify(Object.keys(parts).map(Number)) !== JSON.stringify(meaningful)) throw new Error(`Stale caption mapping: ${cell.id}`);
          for (const [index, p] of cell.paragraphs.entries()) {
            if (p.text.trim()) paragraph(p, parts[index]);
            else { p.text = ""; p.runs = []; }
          }
        } else if (meaningful.length) {
          paragraph(cell.paragraphs[meaningful[0]], text);
          for (const [index, p] of cell.paragraphs.entries()) if (index !== meaningful[0]) { p.text = ""; p.runs = []; }
        }
        cell.content = cell.content.filter((entry) => entry.kind === "image" || cell.paragraphs[entry.index].text.trim());
        for (const image of cell.images) image.alt = cell.paragraphs.find((p) => p.text.trim())?.text || text?.trim() || result.title;
      }
      if (block.kind === "figure") block.image.alt = result.title;
    }
    result.text = result.blocks.map((block) => block.kind === "text" ? block.text : (block.cells || []).flatMap((cell) => cell.paragraphs.map((p) => p.text)).join("\n")).join("\n");
    return result;
  });
}
