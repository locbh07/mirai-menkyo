import { createHash } from "node:crypto";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const targetLocales = ["vi", "en", "zh-Hans", "zh-Hant", "pt"];
const numbers = (text) => text.normalize("NFKC").match(/\d+(?:[.,]\d+)*/g) || [];
const letters = (text) => text.normalize("NFKC").match(/\b[A-D]\b/g) || [];
const sameTokens = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function createHandoff(dataset, colors, locale, datasetSha256) {
  if (!targetLocales.includes(locale)) throw new Error(`Unsupported target locale: ${locale}`);
  const units = [], images = [], articles = [], groups = new Map();
  const colorByImage = new Map(colors.images.map((image) => [image.imageId, image]));
  const sourcePages = (source) => [...new Set([source.page, ...(source.continuations || []).map((part) => part.page)])].sort((a, b) => a - b);
  function unit(id, text, kind, context, runs) {
    const entry = { id, sourceText: text, sourceHash: hash(text), kind, ...context,
      protectedNumbers: numbers(text), protectedLetters: letters(text) };
    if (runs) entry.sourceRuns = runs.map(({ text, reading }) => ({ text, ...(reading ? { reading } : {}) }));
    units.push(entry);
    return id;
  }
  function imageRecord(image, article, block, cell) {
    const label = cell?.paragraphs.find((p) => p.text.trim())?.text.trim() || article.title;
    const color = colorByImage.get(image.id);
    const altUnit = unit(`${image.id}:alt`, label, "image_alt", {
      articleId: article.id, blockId: block.id, cellId: cell?.id || null,
      sourcePages: [image.sourcePage], origin: "editorial-label-not-pdf-inscription",
    });
    images.push({ id: image.id, articleId: article.id, blockId: block.id, cellId: cell?.id || null,
      sourcePage: image.sourcePage, bbox: image.bbox, altUnit,
      original: { path: `media/original/${image.id}.png`, sourcePath: image.path,
        sha256: image.path.split("/").at(-1).replace(".png", ""), width: image.width, height: image.height },
      verifiedColor: color ? { path: `media/color/${image.id}.png`, sourcePath: color.path,
        sha256: color.sha256, width: color.width, height: color.height, code: color.code,
        sourceUrl: color.sourceUrl || colors.source.url, rightsUrl: color.rightsUrl || colors.source.rightsUrl,
        sourceSha256: color.sourceUrl?.includes("commons.wikimedia.org") ? null : colors.source.sha256 } : null });
    return image.id;
  }
  for (const article of dataset.articles) {
    if (!groups.has(article.group.id)) {
      groups.set(article.group.id, unit(`${article.group.id}:title`, article.group.title, "group_title", {
        groupId: article.group.id,
        sourcePages: [...new Set(dataset.articles.filter((a) => a.group.id === article.group.id).flatMap((a) => a.source.pages))].sort((a, b) => a - b),
      }));
    }
    const titleUnit = unit(`${article.id}:title`, article.title, "article_title", { articleId: article.id, sourcePages: article.source.pages });
    function paragraph(p, id, context) {
      const result = { kind: "text", id, tag: p.tag, note: p.note, sourcePages: sourcePages(p.source) };
      if (!p.text.trim()) return { ...result, literal: p.text };
      result.unitId = unit(id, p.text, "paragraph", { articleId: article.id, ...context, sourcePages: result.sourcePages }, p.runs);
      if (p.tag === "h2" && p.text.trim() === article.title.trim()) units.at(-1).duplicateOf = titleUnit;
      return result;
    }
    const blocks = article.blocks.map((block) => {
      if (block.kind === "text") return paragraph(block, block.id, { blockId: block.id });
      if (block.kind === "figure") return { kind: "figure", id: block.id, imageId: imageRecord(block.image, article, block), sourcePages: sourcePages(block.source) };
      const cells = block.cells.map((cell) => {
        const paragraphs = cell.paragraphs.map((p, index) => paragraph(p, `${cell.id}:p${index}`, { blockId: block.id, cellId: cell.id, row: cell.row, column: cell.column }));
        const imageIds = cell.images.map((image) => imageRecord(image, article, block, cell));
        return { id: cell.id, row: cell.row, column: cell.column, rowspan: cell.rowspan, colspan: cell.colspan,
          reference: cell.reference || null, sourceCells: cell.parts,
          content: cell.content.map((entry) => entry.kind === "image" ? { kind: "image", imageId: imageIds[entry.index] } : paragraphs[entry.index]) };
      });
      return { kind: "table", id: block.id, rows: block.rows, columns: block.columns, hasHeader: block.hasHeader,
        layout: block.layout, sourcePages: sourcePages(block.source), cells,
        facsimiles: block.facsimiles.map((image) => ({ page: image.page, path: `media/tables/p${image.page}-${image.path.split("/").at(-1)}`, sourcePath: image.path })) };
    });
    articles.push({ id: article.id, titleUnit, group: { id: article.group.id, titleUnit: groups.get(article.group.id) }, source: article.source, blocks });
  }
  if (new Set(units.map((u) => u.id)).size !== units.length || new Set(images.map((i) => i.id)).size !== images.length) throw new Error("Duplicate source identities");
  const packageId = hash(JSON.stringify({ datasetSha256, locale, units, articles, images }));
  return { version: 1, packageId, targetLocale: locale, sourceLocale: "ja", datasetSha256,
    source: dataset.source, colorSource: colors.source,
    counts: { articles: articles.length, units: units.length, images: images.length,
      colorImages: images.filter((i) => i.verifiedColor).length, tables: dataset.coverage.logicalTables, sourceTableFragments: dataset.coverage.tables },
    units, articles, images };
}

export function articleUnits(bundle, article) {
  return bundle.units.filter((u) => u.articleId === article.id || u.id === article.group.titleUnit);
}

export function translationTemplate(bundle, units = bundle.units) {
  return { version: 1, packageId: bundle.packageId, targetLocale: bundle.targetLocale,
    translations: units.map((u) => ({ unitId: u.id, sourceHash: u.sourceHash, translation: null, status: "pending", notes: [] })) };
}

export function validateTranslations(bundle, files, { complete = false } = {}) {
  const expected = new Map(bundle.units.map((unit) => [unit.id, unit]));
  const entries = new Map(), errors = [], warnings = [];
  for (const file of files) {
    if (file.version !== 1 || file.packageId !== bundle.packageId || file.targetLocale !== bundle.targetLocale || !Array.isArray(file.translations)) {
      errors.push("Wrong version/package/locale or missing translations array");
      continue;
    }
    const seen = new Set();
    for (const entry of file.translations) {
      if (!entry || typeof entry !== "object") { errors.push("Invalid translation entry"); continue; }
      const unit = expected.get(entry.unitId);
      if (!unit || seen.has(entry.unitId)) { errors.push(`Unknown/duplicate unit: ${entry.unitId}`); continue; }
      seen.add(entry.unitId);
      if (entry.sourceHash !== unit.sourceHash) errors.push(`Stale source: ${entry.unitId}`);
      if (!["pending", "translated", "needs_review"].includes(entry.status)) errors.push(`Invalid status: ${entry.unitId}`);
      if (!Array.isArray(entry.notes) || entry.notes.some((note) => typeof note !== "string")) errors.push(`Invalid notes: ${entry.unitId}`);
      if (entry.translation !== null && (typeof entry.translation !== "string" || !entry.translation.trim())) errors.push(`Invalid text: ${entry.unitId}`);
      if (entry.status === "translated" && typeof entry.translation !== "string") errors.push(`Missing translated text: ${entry.unitId}`);
      if (entry.status === "pending" && entry.translation !== null) errors.push(`Pending entry has text: ${entry.unitId}`);
      if (entry.status === "needs_review" && !entry.notes?.length) errors.push(`Review reason missing: ${entry.unitId}`);
      const before = entries.get(entry.unitId);
      if (before && JSON.stringify(before) !== JSON.stringify(entry)) errors.push(`Conflicting batch translation: ${entry.unitId}`);
      entries.set(entry.unitId, entry);
      if (typeof entry.translation === "string") {
        if (!sameTokens(unit.protectedNumbers, numbers(entry.translation))) warnings.push({ unitId: unit.id, reason: "numbers_changed", source: unit.protectedNumbers, target: numbers(entry.translation) });
        if (!sameTokens(unit.protectedLetters, letters(entry.translation))) warnings.push({ unitId: unit.id, reason: "diagram_letters_changed", source: unit.protectedLetters, target: letters(entry.translation) });
        if (/<\/?(?:script|iframe|img|style)\b/i.test(entry.translation)) errors.push(`HTML not accepted: ${entry.unitId}`);
      }
    }
  }
  for (const unit of bundle.units) {
    const entry = entries.get(unit.id);
    if (complete && (!entry || entry.status !== "translated" || typeof entry.translation !== "string" || !entry.translation.trim())) errors.push(`Incomplete unit: ${unit.id}`);
    const duplicate = unit.duplicateOf && entries.get(unit.duplicateOf);
    if (typeof entry?.translation === "string" && typeof duplicate?.translation === "string" && entry.translation.trim() !== duplicate.translation.trim()) errors.push(`Title/body heading mismatch: ${unit.id}`);
  }
  return { valid: errors.length === 0, errors, warnings,
    counts: { total: expected.size, received: entries.size,
      translated: [...entries.values()].filter((entry) => entry.status === "translated" && typeof entry.translation === "string").length,
      needsReview: [...entries.values()].filter((entry) => entry.status === "needs_review").length },
    humanReviewRequired: true };
}

export function imagePlanTemplate(bundle) {
  return { version: 1, packageId: bundle.packageId, sourceSha256: bundle.source.sha256,
    images: bundle.images.map((image) => ({ imageId: image.id, originalSha256: image.original.sha256,
      decision: image.verifiedColor ? "reuse_verified_color" : "keep_original",
      proposedFile: null, proposedSha256: null, sourceUrl: null, rightsUrl: null,
      inscriptions: [], notes: [] })) };
}

export function validateImagePlan(bundle, plan) {
  const errors = [], seen = new Set(), expected = new Map(bundle.images.map((image) => [image.id, image]));
  if (plan.version !== 1 || plan.packageId !== bundle.packageId || plan.sourceSha256 !== bundle.source.sha256 || !Array.isArray(plan.images)) return { valid: false, errors: ["Wrong image-plan source/package"], proposals: 0 };
  let proposals = 0;
  for (const item of plan.images) {
    const source = expected.get(item?.imageId);
    if (!source || seen.has(item.imageId)) { errors.push(`Unknown/duplicate image: ${item?.imageId}`); continue; }
    seen.add(item.imageId);
    if (item.originalSha256 !== source.original.sha256) errors.push(`Changed image source: ${item.imageId}`);
    if (!["keep_original", "reuse_verified_color", "propose_replacement", "needs_review"].includes(item.decision)) errors.push(`Invalid image decision: ${item.imageId}`);
    if (item.decision === "reuse_verified_color" && !source.verifiedColor) errors.push(`No verified color: ${item.imageId}`);
    if (!Array.isArray(item.inscriptions) || item.inscriptions.some((label) => typeof label?.ja !== "string" || typeof label?.translation !== "string" || typeof label?.position !== "string")) errors.push(`Invalid diagram labels: ${item.imageId}`);
    if (!Array.isArray(item.notes) || item.notes.some((note) => typeof note !== "string")) errors.push(`Invalid image notes: ${item.imageId}`);
    if (item.decision === "propose_replacement") {
      proposals += 1;
      if (typeof item.proposedFile !== "string" || !/^proposed-images\/[a-zA-Z0-9_-]+\.(png|webp|svg)$/.test(item.proposedFile) || !/^[a-f0-9]{64}$/.test(item.proposedSha256 || "")) errors.push(`Unsafe/missing proposal file/hash: ${item.imageId}`);
      for (const field of ["sourceUrl", "rightsUrl"]) {
        try { if (new URL(item[field]).protocol !== "https:") throw new Error(); } catch { errors.push(`Missing HTTPS ${field}: ${item.imageId}`); }
      }
      if (!item.notes?.length) errors.push(`Replacement evidence missing: ${item.imageId}`);
    }
    if (item.decision === "needs_review" && !item.notes?.length) errors.push(`Image review reason missing: ${item.imageId}`);
  }
  if (seen.size !== expected.size) errors.push(`Image coverage: ${seen.size}/${expected.size}`);
  return { valid: errors.length === 0, errors, proposals, humanReviewRequired: true };
}
