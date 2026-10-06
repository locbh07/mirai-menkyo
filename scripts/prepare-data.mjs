import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundledSourceRoot = path.join(root, "data", "karimen-honmen-vi");
const workspaceSourceRoot = path.resolve(root, "..", "vocab-backend", "data", "karimen-honmen-vi");
const sourceRoot = existsSync(bundledSourceRoot) ? bundledSourceRoot : workspaceSourceRoot;
const distData = path.join(root, "dist", "data");

function slimQuestion(question) {
  return {
    id: question.source_id,
    number: question.question_number,
    text: question.text?.vi || question.text?.ja || question.text?.en || "",
    textAll: question.text || {},
    correct: question.correct,
    explanation: question.explanation?.vi || "",
    explanationAll: question.explanation || {},
    imagePaths: question.image_paths || question.image_assets?.map((asset) => asset.local_path).filter(Boolean) || [],
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
    const questions = (examSet.questions || []).map(slimQuestion);
    const examPayload = {
      id: examSet.source_id,
      type: examSet.exam_type,
      number: examSet.exam_number,
      title: examTitle(examSet.exam_type, examSet.exam_number),
      timeLimitSeconds: examSet.exam_type === "honmen" ? 3000 : 1800,
      passingScore: 90,
      questions,
    };
    const file = `exam-${examSet.exam_number}.json`;
    await writeFile(path.join(examDir, file), JSON.stringify(examPayload, null, 2), "utf8");
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
