import { cp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDataWriter } from "./data-files.mjs";
import { localizeKnowledge } from "./knowledge-localization.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceRoot = path.join(root, "data", "karimen-honmen-vi");
const distData = path.join(root, "dist", "data");

function questionImagePaths(question) {
  return question.image_paths || question.image_assets?.map((asset) => asset.local_path).filter(Boolean) || [];
}

async function enhancedImageOverrides(questions) {
  const packRoot = path.join(root, "data/enhanced-exam-images");
  const packManifest = path.join(packRoot, "manifest.json");
  const overrides = new Map();
  if (!existsSync(packManifest) || process.env.MENKYO_ORIGINAL_IMAGES === "1") return { overrides, version: null };
  const manifestBytes = await readFile(packManifest);
  const pack = JSON.parse(manifestBytes.toString("utf8"));
  if (pack.version !== 1 || pack.scale !== 4 || pack.pipelineVersion !== 2) throw new Error("Unsupported enhanced image pack");
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const replacements = new Map();
  await mkdir(path.join(distData, "enhanced-exams"), { recursive: true });
  for (const item of pack.images) {
    if (!/^[a-f0-9]{64}$/.test(item.sourceSha256) || !/^[a-f0-9]{64}$/.test(item.outputSha256) || item.file !== `${item.outputSha256}.png`) throw new Error("Invalid enhanced image identity");
    const bytes = await readFile(path.join(packRoot, item.file));
    if (sha256(bytes) !== item.outputSha256 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.readUInt32BE(16) !== item.originalSize[0] * 4 || bytes.readUInt32BE(20) !== item.originalSize[1] * 4) throw new Error(`Invalid enhanced image: ${item.file}`);
    replacements.set(item.sourceSha256, `enhanced-exams/${item.file}`);
    await copyFile(path.join(packRoot, item.file), path.join(distData, "enhanced-exams", item.file));
  }
  for (const original of new Set(questions.flatMap(questionImagePaths))) {
    const sourceFile = path.resolve(sourceRoot, original);
    if (!sourceFile.startsWith(sourceRoot + path.sep)) throw new Error(`Invalid source image path: ${original}`);
    const replacement = replacements.get(sha256(await readFile(sourceFile)));
    if (replacement) overrides.set(original, replacement);
  }
  console.log(`Enhanced images: ${overrides.size} original paths mapped to ${pack.images.length} verified sources`);
  return { overrides, version: sha256(JSON.stringify(pack)).slice(0, 12) };
}

function slimQuestion(question, imageOverrides) {
  return {
    id: question.source_id,
    number: question.question_number,
    text: question.text?.vi || question.text?.ja || question.text?.en || "",
    textAll: question.text || {},
    correct: question.correct,
    explanation: question.explanation?.vi || "",
    explanationAll: question.explanation || {},
    imagePaths: questionImagePaths(question).map((imagePath) => imageOverrides.get(imagePath) || imagePath),
    choices: (question.choices || []).map((choice) => ({
      number: choice.number,
      text: choice.text?.vi || choice.text?.ja || choice.text?.en || "",
      textAll: choice.text || {},
      correct: choice.correct,
    })),
  };
}

export async function prepareData() {
  if (!existsSync(sourceRoot)) {
    throw new Error(`Missing source data: ${sourceRoot}`);
  }

  await rm(distData, { recursive: true, force: true });
  const writer = await createDataWriter(distData);

  const all = JSON.parse(await readFile(path.join(sourceRoot, "all.json"), "utf8"));
  const japaneseRoot = path.join(root, "data/knowledge-ja");
  const japanese = JSON.parse(await readFile(path.join(japaneseRoot, "lessons.json"), "utf8"));
  if (japanese.schemaVersion !== 1 || japanese.source.locale !== "ja") throw new Error("Unsupported Japanese knowledge dataset");
  const colorFile = existsSync(path.join(japaneseRoot, "color-applied-manifest.json")) ? "color-applied-manifest.json" : "color-manifest.json";
  const colorPack = JSON.parse(await readFile(path.join(japaneseRoot, colorFile), "utf8"));
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  if (colorPack.version !== 1 || sha256(await readFile(path.join(japaneseRoot, "color-source.pdf"))) !== colorPack.source.sha256) throw new Error("Invalid color source");
  const colorImages = new Map();
  await mkdir(path.join(distData, "knowledge-ja/colors"), { recursive: true });
  for (const item of colorPack.images) {
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || item.path !== `knowledge-ja/colors/${item.sha256}.png` || colorImages.has(item.imageId)) throw new Error("Invalid color mapping");
    const bytes = await readFile(path.join(japaneseRoot, "colors", `${item.sha256}.png`));
    if (sha256(bytes) !== item.sha256 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.readUInt32BE(16) !== item.width || bytes.readUInt32BE(20) !== item.height) throw new Error(`Invalid color image: ${item.imageId}`);
    colorImages.set(item.imageId, item);
    await writeFile(path.join(distData, item.path), bytes);
  }
  const appliedColors = new Set();
  function runtimeImage(image) {
    const color = colorImages.get(image.id);
    if (!color) return image;
    if (image.path !== `knowledge-ja/assets/${color.originalSha256}.png`) throw new Error(`Changed source illustration: ${image.id}`);
    appliedColors.add(image.id);
    return { ...image, color: { path: color.path, width: color.width, height: color.height, code: color.code, sourceUrl: color.sourceUrl || colorPack.source.url } };
  }
  function runtimeSource(source) {
    const { lines, continuations, ...rest } = source;
    return { ...rest, ...(continuations ? { continuations: continuations.map(runtimeSource) } : {}) };
  }
  function runtimeBlock(block) {
    const { fragments, ...view } = block;
    view.source = runtimeSource(block.source);
    if (block.kind === "text") return { ...view, runs: block.runs.map(({ text, reading }) => ({ text, ...(reading ? { reading } : {}) })) };
    if (block.kind === "table") return { ...view, cells: block.cells.map((cell) => ({ ...cell, paragraphs: cell.paragraphs.map(runtimeBlock), images: cell.images.map(runtimeImage) })) };
    if (block.kind === "figure") return { ...view, image: runtimeImage(block.image) };
    return block;
  }
  function runtimeArticle(article) {
    const blocks = article.blocks.map(runtimeBlock);
    const hasColors = blocks.some((block) => block.cells?.some((cell) => cell.images.some((image) => image.color)) || block.image?.color);
    const references = blocks.flatMap((block) => block.kind === "figure" ? [block.image] : (block.cells || []).flatMap((cell) => cell.images)).filter((image) => image.color);
    return { ...article, sourceArticleId: article.sourceArticleId || article.id,
      ...(hasColors ? { colorSource: colorPack.source, colorSources: [...new Set(references.map((image) => image.color.sourceUrl))] } : {}), blocks };
  }
  const japaneseArticles = japanese.articles.map(runtimeArticle);
  const translation = JSON.parse(await readFile(path.join(root, "data/knowledge-vi/lessons-vi.json"), "utf8"));
  if (translation.sourceDatasetSha256 !== sha256(await readFile(path.join(japaneseRoot, "lessons.json")))) throw new Error("Stale Vietnamese knowledge source");
  const editorial = JSON.parse(await readFile(path.join(root, "data/knowledge-vi/editorial-overrides.json"), "utf8"));
  const vietnameseArticles = localizeKnowledge(japanese, translation, editorial).map(runtimeArticle);
  if (appliedColors.size !== colorImages.size) throw new Error("Orphan color mapping");
  console.log(`Japanese knowledge: ${japanese.coverage.logicalTables} logical tables / ${japanese.coverage.tables} source fragments, ${appliedColors.size} verified color references`);
  const questions = all.exam_sets.flatMap((exam) => exam.questions || []);
  const { overrides: imageOverrides, version: imageVersion } = await enhancedImageOverrides(questions);
  const entries = questions.flatMap((question) => [question, ...(question.choices || [])]);
  const locales = Object.keys(entries[0]?.text || {}).filter((locale) =>
    entries.every((entry) => typeof entry.text?.[locale] === "string" && entry.text[locale].trim()),
  );
  const manifest = {
    brand: "Mirai Menkyo",
    locale: all.metadata?.locale || "vi",
    locales,
    knowledgeLocale: all.metadata?.locale || "vi",
    knowledgeLocales: ["ja", "vi"],
    knowledgeDefaultLocale: "vi",
    knowledgeFallbackLocale: "ja",
    knowledgeSources: { ja: japanese.source },
    generatedAt: all.metadata?.scraped_at,
    imageVersion,
    dataFormat: "aes-gcm-v1",
    exams: [],
    stats: {
      examSets: all.exam_sets.length,
      examQuestions: all.exam_questions.length,
      knowledgeArticles: all.knowledge_articles.length + japanese.articles.length,
      knowledgeByLocale: { ja: japanese.articles.length, vi: all.knowledge_articles.length + vietnameseArticles.length },
      testLocations: all.test_locations.length,
    },
  };

  for (const examSet of all.exam_sets) {
    const questions = (examSet.questions || []).map((question) => slimQuestion(question, imageOverrides));
    const examPayload = {
      id: examSet.source_id,
      type: examSet.exam_type,
      number: examSet.exam_number,
      title: examTitle(examSet.exam_type, examSet.exam_number),
      timeLimitSeconds: examSet.exam_type === "honmen" ? 3000 : 1800,
      passingScore: 90,
      questions,
    };
    const examPath = await writer.write(examPayload);
    manifest.exams.push({
      id: examSet.source_id,
      type: examSet.exam_type,
      number: examSet.exam_number,
      title: examPayload.title,
      questionCount: questions.length,
      path: examPath,
    });
  }

  manifest.knowledgePath = await writer.write(
    [...vietnameseArticles, ...japaneseArticles, ...all.knowledge_articles.map((article) => ({
      id: article.source_id,
      locale: article.locale || all.metadata?.locale || "vi",
      slug: article.slug,
      title: article.title,
      text: article.content_text,
      blocks: article.blocks || [],
      tables: article.tables || [],
      images: article.images || [],
    }))],
  );
  manifest.locationsPath = await writer.write(all.test_locations);
  const manifestPath = await writer.write(manifest);
  await writeFile(path.join(root, "dist/data-config.js"), `export const dataConfig = Object.freeze(${JSON.stringify({ version: 1, keyBase64: writer.keyBase64, manifestPath })});\n`, "utf8");

  const assetSource = path.join(sourceRoot, "assets");
  if (existsSync(assetSource)) {
    await cp(assetSource, path.join(distData, "assets"), { recursive: true });
  }
  await cp(path.join(japaneseRoot, "assets"), path.join(distData, "knowledge-ja/assets"), { recursive: true });
}

function examTitle(type, number) {
  const names = {
    karimen: "Karimen",
    honmen: "Honmen",
    gentsuki: "Xe gắn máy",
  };
  return `${names[type] || type} ${number}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await prepareData();
}
