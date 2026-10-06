import { cp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  return { overrides, version: sha256(manifestBytes).slice(0, 12) };
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
  await mkdir(path.join(distData, "exams"), { recursive: true });

  const all = JSON.parse(await readFile(path.join(sourceRoot, "all.json"), "utf8"));
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
    generatedAt: all.metadata?.scraped_at,
    imageVersion,
    exams: [],
    stats: {
      examSets: all.exam_sets.length,
      examQuestions: all.exam_questions.length,
      knowledgeArticles: all.knowledge_articles.length,
      testLocations: all.test_locations.length,
    },
  };

  for (const examSet of all.exam_sets) {
    const examDir = path.join(distData, "exams", examSet.exam_type);
    await mkdir(examDir, { recursive: true });
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
    const legacyFile = `exam-${examSet.exam_number}.json`;
    const file = imageVersion ? `exam-${examSet.exam_number}-${imageVersion}.json` : legacyFile;
    const examJson = JSON.stringify(examPayload, null, 2);
    await writeFile(path.join(examDir, file), examJson, "utf8");
    if (file !== legacyFile) await writeFile(path.join(examDir, legacyFile), examJson, "utf8");
    manifest.exams.push({
      id: examSet.source_id,
      type: examSet.exam_type,
      number: examSet.exam_number,
      title: examPayload.title,
      questionCount: questions.length,
      path: `data/exams/${examSet.exam_type}/${file}`,
    });
  }

  await writeFile(path.join(distData, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(
    path.join(distData, "knowledge.json"),
    JSON.stringify(
      all.knowledge_articles.map((article) => ({
        id: article.source_id,
        locale: article.locale || all.metadata?.locale || "vi",
        slug: article.slug,
        title: article.title,
        text: article.content_text,
        blocks: article.blocks || [],
        tables: article.tables || [],
        images: article.images || [],
      })),
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(path.join(distData, "locations.json"), JSON.stringify(all.test_locations, null, 2), "utf8");

  const assetSource = path.join(sourceRoot, "assets");
  if (existsSync(assetSource)) {
    await cp(assetSource, path.join(distData, "assets"), { recursive: true });
  }
}

function examTitle(type, number) {
  const names = {
    karimen: "Karimen",
    honmen: "Honmen",
    gentsuki: "Xe gắn máy",
  };
  return `${names[type] || type} ${number}`;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  await prepareData();
}
