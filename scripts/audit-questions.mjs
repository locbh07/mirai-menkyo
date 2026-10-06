import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceRoot = path.join(root, "data", "karimen-honmen-vi");
const sourceBytes = await readFile(path.join(sourceRoot, "all.json"));
const data = JSON.parse(sourceBytes.toString("utf8"));
const normalize = (text) => String(text || "").normalize("NFKC").replace(/\s+/g, " ").trim();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const assetHashes = new Map();
const missingImages = [];
const records = [];

for (const exam of data.exam_sets) {
  for (const question of exam.questions) {
    const paths = [...new Set([...(question.image_paths || []), ...(question.image_assets || []).map((image) => image.local_path)].filter((value) => typeof value === "string" && value))];
    const images = [];
    for (const localPath of paths) {
      if (!assetHashes.has(localPath)) {
        try {
          assetHashes.set(localPath, hash(await readFile(path.join(sourceRoot, localPath))));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          assetHashes.set(localPath, `missing:${localPath}`);
          missingImages.push({ questionId: question.source_id, path: localPath });
        }
      }
      images.push(assetHashes.get(localPath));
    }
    if (!paths.length && question.raw?.images?.length) {
      const references = question.raw.images.map((name) => `assets/${exam.exam_type}/exams/${exam.exam_number}/${name.replace(/^\.\//, "")}`);
      for (const localPath of references) {
        images.push(`unresolved:${localPath}`);
        missingImages.push({ questionId: question.source_id, path: localPath });
      }
    }
    records.push({ question, images, examId: exam.source_id, type: exam.exam_type });
  }
}

function signature(record, locale, includeAnswers = true) {
  const q = record.question;
  return JSON.stringify({
    text: normalize(q.text?.[locale]),
    images: record.images,
    ...(includeAnswers ? { correct: q.correct } : {}),
    choices: (q.choices || []).map((choice) => ({
      text: normalize(choice.text?.[locale]),
      ...(includeAnswers ? { correct: choice.correct } : {}),
    })),
  });
}

function groupBy(list, key) {
  const groups = new Map();
  for (const record of list) {
    const value = key(record);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(record);
  }
  return [...groups.values()];
}

function duplicates(list, locale) {
  return groupBy(list, (record) => signature(record, locale)).filter((group) => group.length > 1).map((group) => ({
    questionIds: group.map((record) => record.question.source_id),
    examIds: [...new Set(group.map((record) => record.examId))],
    types: [...new Set(group.map((record) => record.type))],
    text: group[0].question.text?.[locale] || "",
  }));
}

const locales = Object.keys(records[0].question.text);
const stats = (list, locale) => {
  const groups = groupBy(list, (record) => signature(record, locale));
  return { occurrences: list.length, unique: groups.length, redundantOccurrences: list.length - groups.length, duplicateGroups: groups.filter((group) => group.length > 1).length };
};
const duplicateGroups = duplicates(records, "ja");
const perType = ["karimen", "honmen", "gentsuki"].map((type) => {
  const list = records.filter((record) => record.type === type);
  return {
    type,
    examSets: data.exam_sets.filter((exam) => exam.exam_type === type).length,
    ...stats(list, "ja"),
    uniqueVietnamese: stats(list, "vi").unique,
    compoundQuestions: list.filter((record) => record.question.choices?.length).length,
    explanationsVietnamese: list.filter((record) => record.question.explanation?.vi?.trim()).length,
  };
});
const answerConflicts = groupBy(records, (record) => signature(record, "ja", false)).filter((group) => new Set(group.map((record) => signature(record, "ja"))).size > 1).map((group) => ({ questionIds: group.map((record) => record.question.source_id), textJapanese: group[0].question.text.ja }));
const report = {
  sourceSha256: hash(sourceBytes),
  scrapedAt: data.metadata.scraped_at,
  method: "Exact normalized Japanese prompt, ordered choice text, correct answers and SHA-256 image contents. NFKC and whitespace normalization only. Image filenames, question IDs, explanations and translated wording are not part of the Japanese key. Missing images retain distinct unresolved references. Similar meanings with different wording are not merged.",
  examSets: data.exam_sets.length,
  ...stats(records, "ja"),
  perType,
  perLocale: Object.fromEntries(locales.map((locale) => [locale, stats(records, locale)])),
  crossExamDuplicateGroups: duplicateGroups.filter((group) => group.examIds.length > 1).length,
  withinExamDuplicateGroups: duplicateGroups.filter((group) => group.examIds.length === 1).length,
  duplicateGroups,
  vietnameseDuplicateGroups: duplicates(records, "vi"),
  answerConflicts,
  explanationsVietnamese: records.filter((record) => record.question.explanation?.vi?.trim()).length,
  missingImages,
  examFormats: data.exam_sets.map((exam) => ({ id: exam.source_id, type: exam.exam_type, questions: exam.questions.length, compoundQuestions: exam.questions.filter((q) => q.choices?.length).length })),
};
const lines = [
  "# Question Bank Audit", "", `Source: data/karimen-honmen-vi/all.json (SHA-256: ${report.sourceSha256}).`, "",
  report.method, "", "Counts refer to main questions; a three-statement illustration question counts as one question. Translations are not additional questions.", "",
  "| Type | Sets | Occurrences | Unique Japanese | Unique Vietnamese |", "| --- | ---: | ---: | ---: | ---: |",
  ...perType.map((item) => `| ${item.type} | ${item.examSets} | ${item.occurrences} | ${item.unique} | ${item.uniqueVietnamese} |`),
  `| All | ${report.examSets} | ${report.occurrences} | ${report.unique} | ${report.perLocale.vi.unique} |`, "",
  "Global counts are recomputed across all types, not added from per-type counts. Exact wording differs between translations; this report does not establish semantic uniqueness or complete syllabus coverage.", "",
  "## Exact Japanese Duplicates", "", ...duplicateGroups.map((group) => `- ${group.questionIds.join(" = ")}`), "",
  `There are ${report.crossExamDuplicateGroups} groups shared between different exam sets and ${report.withinExamDuplicateGroups} groups repeated within one exam set.`, "",
  "## Exact Vietnamese Duplicates", "", ...report.vietnameseDuplicateGroups.map((group) => `- ${group.questionIds.join(" = ")}`), "",
  "The Vietnamese text has one duplicate shared by Honmen and Gentsuki. Its global unique count is therefore one less than the sum of unique counts within the three types.", "",
  "## Data Quality", "",
  `- Conflicting answer groups for otherwise identical Japanese content and images: ${answerConflicts.length}.`,
  `- Vietnamese explanations present: ${report.explanationsVietnamese}/${report.occurrences}.`,
  ...missingImages.map((item) => `- Missing image: ${item.questionId}, ${item.path}.`), "",
  "## Exam Coverage Assessment", "",
  "The 16 Karimen sets have 50 true/false questions each. The 16 Honmen sets have 90 true/false questions and five three-statement illustration questions each. The five Gentsuki sets currently have 50 true/false questions each, without compound illustration questions.", "",
  "Official Gentsuki exams have 46 text questions and two three-statement illustration questions (48 main questions total). Current Gentsuki sets are practice material, not format-accurate mock exams. Quantity alone cannot prove topic coverage, correctness, current-law compliance or readiness to pass.", "",
  "References:", "",
  "- [Official exam formats, Hiroshima Police](https://www.pref.hiroshima.lg.jp/site/police1/061-u-jyuken-309sikensyubetu2.html)",
  "- [NPA exam format and coverage standard](https://www.npa.go.jp/laws/notification/koutuu/menkyo/menkyo20230330_46.pdf)",
  "- [NPA residential-road speed rules effective September 1, 2026](https://www.npa.go.jp/bureau/traffic/seikatsudouro/seikatsudoro.html)", "",
  "Legal and topic coverage have not been exhaustively audited. Current source material must be reviewed against these standards before claiming complete exam coverage.", "",
  "The existing speeding knowledge article still presents a general car limit of 60 km/h without distinguishing the updated residential-road classes. It needs review against the September 2026 rule change; this audit does not automatically rewrite answers or legal guidance.", "",
];
await mkdir(path.join(root, "reports"), { recursive: true });
await writeFile(path.join(root, "reports", "question-audit.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
await writeFile(path.join(root, "reports", "question-audit.md"), lines.join("\n"), "utf8");
console.log(JSON.stringify({ examSets: report.examSets, occurrences: report.occurrences, uniqueJapanese: report.unique, uniqueVietnamese: report.perLocale.vi.unique, crossExamDuplicateGroups: report.crossExamDuplicateGroups, withinExamDuplicateGroups: report.withinExamDuplicateGroups, perType, answerConflicts: answerConflicts.length, missingImages }, null, 2));
