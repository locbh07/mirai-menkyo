import { languages, languageFlags, translate } from "./i18n.js";
import { icon } from "./icons.js";

const storedLocale = localStorage.getItem("mirai-menkyo-locale");
const state = {
  locale: languages[storedLocale] ? storedLocale : "vi",
  questionNavOpen: window.matchMedia("(min-width: 901px)").matches,
  tab: "exams",
  manifest: null,
  examHomeScroll: 0,
  currentExam: null,
  currentQuestionIndex: 0,
  answers: {},
  submitted: false,
  result: null,
  timerId: null,
  advanceTimer: null,
  secondsLeft: 0,
  knowledge: null,
  knowledgeSearch: "",
  knowledgeScroll: 0,
  currentArticle: null,
  locations: null,
  search: "",
};

const examTypes = ["karimen", "honmen", "gentsuki"];

function t(key, values) {
  return translate(state.locale, key, values);
}

function examTypeLabel(type) {
  if (type === "all" || type === "gentsuki") return t(type);
  if (state.locale === "ja") return type === "karimen" ? "仮免" : "本免";
  return type === "karimen" ? "Karimen" : "Honmen";
}

function examTitle(exam) {
  return t("examTitle", { type: examTypeLabel(exam.type), number: exam.number });
}

function localizedText(item, field = "text") {
  return item[`${field}All`]?.[state.locale] || item[field] || "";
}

function languageFlag(locale) {
  return `<img class="language-flag" src="assets/flags/${languageFlags[locale]}.png" width="24" height="16" alt="" aria-hidden="true" />`;
}

function renderLanguageMenu() {
  const locales = state.manifest?.locales || [state.locale];
  return `
    <details class="language-menu">
      <summary class="language-trigger" aria-label="${t("language")}: ${escapeAttribute(languages[state.locale])}">
        ${languageFlag(state.locale)}<span>${escapeHtml(languages[state.locale])}</span>
      </summary>
      <div class="language-options" role="group" aria-label="${t("language")}">
        ${locales.map((locale) => `
          <button class="language-option" data-locale="${escapeAttribute(locale)}" lang="${escapeAttribute(locale)}" aria-pressed="${locale === state.locale}">
            ${languageFlag(locale)}<span>${escapeHtml(languages[locale] || locale)}</span>
            <span class="language-choice" aria-hidden="true"></span>
          </button>
        `).join("")}
      </div>
    </details>
  `;
}

const app = document.querySelector("#app");

init();

async function init() {
  app.innerHTML = renderShell(`<div class="loading">${t("loading")}</div>`);
  try {
    state.manifest = await fetchJson("data/manifest.json", { cache: "no-cache" });
    if (!state.manifest.locales?.includes(state.locale)) state.locale = state.manifest.locale;
    render();
  } catch (error) {
    showError(new Error(`${t("loadError")}: ${error.message}`));
  }
}

function render() {
  if (state.tab !== "practice" || state.submitted) clearAutoAdvance();
  const oldNav = document.querySelector(".question-nav");
  const navScroll = oldNav && oldNav.dataset.examId === state.currentExam?.id
    ? [oldNav.querySelector(".question-list").scrollTop, oldNav.querySelector(".question-dots").scrollTop]
    : [0, 0];
  if (state.timerId && state.tab !== "practice") {
    clearInterval(state.timerId);
    state.timerId = null;
  }

  let content = "";
  if (state.tab === "exams") content = renderExamHome();
  if (state.tab === "practice") content = renderPractice();
  if (state.tab === "knowledge") content = renderKnowledge();
  if (state.tab === "locations") content = renderLocations();
  app.innerHTML = renderShell(content);
  bindEvents();
  const newNav = document.querySelector(".question-nav");
  if (newNav) {
    newNav.querySelector(".question-list").scrollTop = navScroll[0];
    newNav.querySelector(".question-dots").scrollTop = navScroll[1];
  }
}

function renderShell(content) {
  document.documentElement.lang = state.locale;
  document.title = `Mirai Menkyo - ${t("homeTitle")}`;
  return `
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <div class="brand-mark">${icon("car")}</div>
            <div>
              <div class="brand-name">Mirai Menkyo</div>
              <div class="brand-subtitle">Karimen · Honmen · Gentsuki</div>
            </div>
          </div>
          <nav class="nav-tabs" aria-label="${t("navigation")}">
            ${tabButton("exams", t("exams"))}
            ${tabButton("knowledge", t("knowledge"))}
            ${tabButton("locations", t("locations"))}
          </nav>
          <div class="top-actions">
            ${renderLanguageMenu()}
            <span class="premium-chip">${t("premium")}</span>
          </div>
        </div>
      </header>
      <main class="main">${content}</main>
    </div>
  `;
}

function tabButton(tab, label) {
  const active = state.tab === tab || (tab === "exams" && state.tab === "practice");
  const symbol = { exams: "clipboard-check", knowledge: "book-open", locations: "map-pin" }[tab];
  return `<button class="tab-button ${active ? "active" : ""}" data-tab="${tab}" aria-current="${active ? "page" : "false"}">${icon(symbol)}<span>${label}</span></button>`;
}

function renderExamHome() {
  const stats = state.manifest.stats;
  return `
    <section class="page-head">
      <div>
        <p class="page-kicker">${t("homeKicker")}</p>
        <h1 class="page-title">${t("homeTitle")}</h1>
        <p class="page-copy">
          ${t("homeCopy")}
        </p>
      </div>
      <div class="stats">
        ${stat(stats.examSets, t("sets"))}
        ${stat(stats.examQuestions, t("questions"))}
        ${stat(stats.knowledgeArticles, t("lessons"))}
      </div>
    </section>
    <nav class="exam-shortcuts" aria-label="${t("exams")}">
      ${examTypes.map((type) => `<a class="exam-shortcut ${type}" href="#exams-${type}">${escapeHtml(examTypeLabel(type))}<span>${state.manifest.exams.filter((exam) => exam.type === type).length}</span></a>`).join("")}
    </nav>
    ${examTypes.map(renderExamSection).join("")}
  `;
}

function renderExamSection(type) {
  const exams = state.manifest.exams.filter((exam) => exam.type === type);
  return `
    <section class="exam-section ${type}" id="exams-${type}" data-exam-type="${type}" aria-labelledby="heading-${type}">
      <div class="exam-section-head">
        <div>
          <h2 id="heading-${type}">${escapeHtml(examTypeLabel(type))}</h2>
          <p>${t(`${type}Description`)}</p>
        </div>
        <span class="exam-section-count">${exams.length} ${t("sets")}</span>
      </div>
      <div class="exam-grid">${exams.map(renderExamCard).join("")}</div>
    </section>
  `;
}

function renderExamCard(exam) {
  return `
    <button class="exam-card ${exam.type}" data-start-exam="${exam.id}">
      <span class="exam-type">${escapeHtml(examTypeLabel(exam.type))}</span>
      <span class="exam-title">${escapeHtml(examTitle(exam))}</span>
      <span class="exam-meta">${t("examMeta", { count: exam.questionCount, minutes: exam.type === "honmen" ? 50 : 30 })}</span>
      <span class="card-bottom">
        <span class="score-pill">${escapeHtml(savedScore(exam.id))}</span>
        <span class="start-pill">${t("start")}</span>
      </span>
    </button>
  `;
}

function stat(value, label) {
  return `<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
}

async function startExam(id) {
  const item = state.manifest.exams.find((exam) => exam.id === id);
  if (!item) return;
  clearAutoAdvance();
  state.examHomeScroll = window.scrollY;
  state.currentExam = await fetchJson(item.path);
  state.questionNavOpen = window.matchMedia("(min-width: 901px)").matches;
  state.currentQuestionIndex = 0;
  state.answers = {};
  state.submitted = false;
  state.result = null;
  state.secondsLeft = state.currentExam.timeLimitSeconds;
  state.tab = "practice";
  startTimer();
  render();
  window.scrollTo(0, 0);
}

function renderPractice() {
  const exam = state.currentExam;
  if (!exam) {
    state.tab = "exams";
    return renderExamHome();
  }
  const question = exam.questions[state.currentQuestionIndex];
  return `
    <section class="exam-layout">
      <aside class="question-nav" data-exam-id="${escapeAttribute(exam.id)}">
        <div class="exam-header">
          <strong>${escapeHtml(examTitle(exam))}</strong>
          <div class="timer-row">
            <span>${t("count", { count: exam.questions.length })}</span>
            <span class="timer">${formatTime(state.secondsLeft)}</span>
          </div>
          ${state.result ? renderResult() : ""}
        </div>
        <details class="question-list" ${state.questionNavOpen ? "open" : ""}>
          <summary>${t("questionList")}<span>${t("answered", { count: exam.questions.filter(isQuestionAnswered).length, total: exam.questions.length })}</span></summary>
          <div class="question-dots">
            ${exam.questions.map((item, index) => renderDot(item, index)).join("")}
          </div>
        </details>
      </aside>
      <section class="question-panel">
        <div class="question-topline">
          <button class="icon-button" data-back-exams aria-label="${t("examList")}" data-tooltip="${t("examList")}">${icon("layout-grid")}</button>
          <span class="question-position">${t("question", { number: state.currentQuestionIndex + 1 })} / ${exam.questions.length}</span>
        </div>
        ${renderQuestionImages(question)}
        <h2 class="question-title" tabindex="-1">${t("question", { number: state.currentQuestionIndex + 1 })}. ${escapeHtml(localizedText(question))}</h2>
        ${question.choices.length ? renderChoiceQuestion(question) : renderTrueFalseQuestion(question)}
        ${state.submitted && localizedText(question, "explanation") ? `<div class="explanation"><strong>${t("explanation")}:</strong> ${escapeHtml(localizedText(question, "explanation"))}</div>` : ""}
        <div class="question-footer">
          <div class="question-pager">
            <button class="icon-button" data-prev-question aria-label="${t("previous")}" data-tooltip="${t("previous")}" ${state.currentQuestionIndex === 0 ? "disabled" : ""}>${icon("chevron-left")}</button>
            <span class="pager-position">${state.currentQuestionIndex + 1}<span> / ${exam.questions.length}</span></span>
            <button class="icon-button" data-next-question aria-label="${t("next")}" data-tooltip="${t("next")}" ${state.currentQuestionIndex === exam.questions.length - 1 ? "disabled" : ""}>${icon("chevron-right")}</button>
          </div>
          <button class="button submit-button" data-submit-exam>${icon(state.submitted ? "rotate-ccw" : "clipboard-check")}<span>${t(state.submitted ? "resubmit" : "submit")}</span></button>
        </div>
      </section>
    </section>
  `;
}

function renderQuestionImages(question) {
  if (!question.imagePaths?.length) return "";
  return `
    <div class="question-images">
      ${question.imagePaths
        .map((imagePath) => `<img src="data/${escapeAttribute(imagePath)}" alt="${t("questionImage", { number: question.number })}" loading="eager" decoding="async" />`)
        .join("")}
    </div>
  `;
}

function renderTrueFalseQuestion(question) {
  const answer = state.answers[question.id]?.value;
  return `
    <div class="answer-actions">
      ${answerButton(question, true, t("correct"), answer === true)}
      ${answerButton(question, false, t("incorrect"), answer === false)}
    </div>
  `;
}

function answerButton(question, value, label, selected) {
  let cls = selected ? "selected" : "";
  if (state.submitted) {
    if (value === question.correct) cls = "correct";
    else if (selected) cls = "incorrect";
  }
  return `<button class="answer-button ${cls}" data-answer="${value}" aria-pressed="${selected}" ${state.advanceTimer !== null ? "disabled" : ""}>${icon(value ? "check" : "x")}<span>${label}</span></button>`;
}

function renderChoiceQuestion(question) {
  const selected = state.answers[question.id] || {};
  return `
    <div class="choice-list">
      ${question.choices
        .map(
          (choice) => `
            <div class="choice-item">
              <div class="choice-text">${escapeHtml(localizedText(choice))}</div>
              <div class="answer-actions">
                ${choiceButton(question, choice, true, selected[choice.number] === true)}
                ${choiceButton(question, choice, false, selected[choice.number] === false)}
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function choiceButton(question, choice, value, selected) {
  let cls = selected ? "selected" : "";
  if (state.submitted) {
    if (value === choice.correct) cls = "correct";
    else if (selected) cls = "incorrect";
  }
  return `<button class="answer-button ${cls}" data-choice-answer="${choice.number}:${value}" aria-pressed="${selected}" ${state.advanceTimer !== null ? "disabled" : ""}>${icon(value ? "check" : "x")}<span>${t(value ? "correct" : "incorrect")}</span></button>`;
}

function renderDot(question, index) {
  let cls = "";
  if (index === state.currentQuestionIndex) cls += " current";
  if (isQuestionAnswered(question)) cls += " answered";
  if (state.submitted) cls += isQuestionCorrect(question) ? " good" : " bad";
  return `<button class="dot ${cls}" data-go-question="${index}" aria-label="${t("question", { number: index + 1 })}" ${index === state.currentQuestionIndex ? 'aria-current="step"' : ""}>${index + 1}</button>`;
}

function renderResult() {
  const result = state.result;
  return `
    <div class="result-box">
      <p class="result-score">${result.score}/${result.total}</p>
      <p>${t(result.passed ? "passed" : "failed", { score: state.currentExam.passingScore })}</p>
    </div>
  `;
}

function answerCurrent(value) {
  if (state.advanceTimer !== null) return;
  const question = state.currentExam.questions[state.currentQuestionIndex];
  state.answers[question.id] = { value };
  advanceAfterAnswer(question);
  render();
}

function answerChoice(raw) {
  if (state.advanceTimer !== null) return;
  const [choiceNumber, value] = raw.split(":");
  const question = state.currentExam.questions[state.currentQuestionIndex];
  state.answers[question.id] = {
    ...(state.answers[question.id] || {}),
    [choiceNumber]: value === "true",
  };
  if (isQuestionAnswered(question)) advanceAfterAnswer(question);
  render();
}

function isQuestionAnswered(question) {
  const answer = state.answers[question.id];
  if (!answer) return false;
  return question.choices.length
    ? question.choices.every((choice) => typeof answer[choice.number] === "boolean")
    : typeof answer.value === "boolean";
}

function clearAutoAdvance() {
  if (state.advanceTimer !== null) clearTimeout(state.advanceTimer);
  state.advanceTimer = null;
}

function advanceAfterAnswer(question) {
  if (state.submitted || state.currentQuestionIndex >= state.currentExam.questions.length - 1) return;
  const examId = state.currentExam.id;
  state.advanceTimer = setTimeout(() => {
    state.advanceTimer = null;
    if (state.tab !== "practice" || state.submitted || state.currentExam?.id !== examId || state.currentExam.questions[state.currentQuestionIndex]?.id !== question.id) return;
    state.currentQuestionIndex += 1;
    render();
    revealQuestion(examId, state.currentExam.questions[state.currentQuestionIndex].id).catch(showError);
  }, 250);
}

async function revealQuestion(examId, questionId) {
  const heading = document.querySelector(".question-title");
  const images = document.querySelector(".question-images");
  if (images) {
    await Promise.allSettled([...images.querySelectorAll("img")].map((image) => image.decode()));
  }
  if (!heading?.isConnected || state.tab !== "practice" || state.submitted || state.advanceTimer !== null || state.currentExam?.id !== examId || state.currentExam.questions[state.currentQuestionIndex]?.id !== questionId) return;
  const header = document.querySelector(".topbar");
  const offset = header && getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().height + 16 : 16;
  const target = images || heading;
  target.style.scrollMarginTop = `${offset}px`;
  heading.focus({ preventScroll: true });
  target.scrollIntoView({ block: images ? "start" : "nearest" });
}

function goToQuestion(index) {
  clearAutoAdvance();
  state.currentQuestionIndex = Math.min(state.currentExam.questions.length - 1, Math.max(0, index));
  render();
}

function scoreExam() {
  clearAutoAdvance();
  const exam = state.currentExam;
  let score = 0;
  let total = 0;
  for (const question of exam.questions) {
    const point = getQuestionPoint(exam, question);
    total += point;
    if (isQuestionCorrect(question)) score += point;
  }
  state.submitted = true;
  state.result = { score, total, passed: score >= exam.passingScore };
  localStorage.setItem(`mirai-menkyo-score:${exam.id}`, `${score}/${total}`);
  clearInterval(state.timerId);
  state.timerId = null;
  render();
}

function getQuestionPoint(exam, question) {
  if (exam.type === "honmen") return question.number >= 91 ? 2 : 1;
  return 2;
}

function isQuestionCorrect(question) {
  const answer = state.answers[question.id];
  if (!answer) return false;
  if (!question.choices.length) return answer.value === question.correct;
  return question.choices.every((choice) => answer[choice.number] === choice.correct);
}

function savedScore(id) {
  return localStorage.getItem(`mirai-menkyo-score:${id}`) || t("notStarted");
}

function startTimer() {
  clearInterval(state.timerId);
  state.timerId = setInterval(() => {
    if (state.secondsLeft <= 1) {
      state.secondsLeft = 0;
      scoreExam();
      return;
    }
    state.secondsLeft -= 1;
    const timer = document.querySelector(".timer");
    if (timer) timer.textContent = formatTime(state.secondsLeft);
  }, 1000);
}

async function renderKnowledgeAsync() {
  if (!state.knowledge) state.knowledge = await fetchJson("data/knowledge.json");
  render();
}

function renderKnowledge() {
  if (!state.knowledge) {
    renderKnowledgeAsync().catch(showError);
    return `<div class="loading">${t("loading")}</div>`;
  }

  if (state.currentArticle) {
    const article = state.knowledge.find((item) => item.id === state.currentArticle);
    if (!article) state.currentArticle = null;
    else return renderArticle(article);
  }

  const keyword = normalizeSearch(state.knowledgeSearch);
  const articles = state.knowledge.filter((article) => normalizeSearch(`${article.title} ${article.text || ""}`).includes(keyword));
  return `
    <section class="page-head knowledge-head">
      <div>
        <p class="page-kicker">${t("knowledgeKicker")}</p>
        <h1 class="page-title">${t("knowledgeTitle")}</h1>
        <p class="page-copy">${t("knowledgeCopy")}</p>
        ${state.locale !== (state.manifest.knowledgeLocale || "vi") ? `<p class="content-language">${t("knowledgeLanguage")}</p>` : ""}
      </div>
      <span class="knowledge-count">${t("knowledgeCount", { count: state.knowledge.length })}</span>
    </section>
    <div class="knowledge-toolbar">
      <input class="search knowledge-search" type="search" data-knowledge-search value="${escapeAttribute(state.knowledgeSearch)}" placeholder="${t("knowledgeSearch")}" aria-label="${t("knowledgeSearch")}" />
      <span class="knowledge-results" aria-live="polite">${keyword ? t("knowledgeCount", { count: articles.length }) : ""}</span>
    </div>
    <section class="knowledge-list" aria-label="${t("knowledgeTitle")}">
      ${articles.map(renderKnowledgeRow).join("") || `<div class="empty-state">${t("empty")}</div>`}
    </section>
  `;
}

function normalizeSearch(value) {
  return String(value || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
}

function articleBodyBlocks(article) {
  const normalizeHeading = (text) => String(text || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  const title = normalizeHeading(article.title);
  return (article.blocks || []).filter((block) => !(/^h[1-6]$/.test(block.tag) && normalizeHeading(block.text) === title));
}

function articleExcerpt(article) {
  const blocks = articleBodyBlocks(article);
  const text = blocks.find((block) => block.tag === "p" || block.tag === "li")?.text?.trim() || "";
  return text.length > 180 ? `${text.slice(0, 180).trimEnd()}...` : text;
}

function renderKnowledgeRow(article) {
  const index = state.knowledge.indexOf(article) + 1;
  const available = articleBodyBlocks(article).length || article.tables?.length || article.images?.length;
  return `
    <button class="article-row" data-open-article="${escapeAttribute(article.id)}" ${available ? "" : "disabled"}>
      <span class="article-number" aria-hidden="true">${String(index).padStart(2, "0")}</span>
      <span class="article-summary">
        <span class="article-row-title" lang="${article.locale || "vi"}">${escapeHtml(article.title)}</span>
        <span class="article-excerpt" ${available ? `lang="${article.locale || "vi"}"` : ""}>${escapeHtml(articleExcerpt(article) || (available ? "" : t("articleUnavailable")))}</span>
      </span>
      <span class="article-arrow" aria-hidden="true"></span>
    </button>
  `;
}

function renderArticle(article) {
  return `
    <section class="article-view">
      <div class="article-toolbar">
        <button class="button secondary" data-close-article>${t("back")}</button>
        <span>${t("knowledgeTitle")}</span>
      </div>
      ${state.locale !== (article.locale || "vi") ? `<p class="content-language">${t("knowledgeLanguage")}</p>` : ""}
      <h1 lang="${article.locale || "vi"}">${escapeHtml(article.title)}</h1>
      <div class="article-body" lang="${article.locale || "vi"}">
      ${renderArticleBlocks(article)}
      ${renderArticleTables(article)}
      ${renderArticleImages(article)}
      </div>
    </section>
  `;
}

function renderArticleBlocks(article) {
  let content = "";
  let inList = false;
  for (const block of articleBodyBlocks(article)) {
    if (block.tag === "li" && !inList) {
      content += '<ul class="article-block-list">';
      inList = true;
    } else if (block.tag !== "li" && inList) {
      content += "</ul>";
      inList = false;
    }
    const tag = block.tag === "h1" ? "h2" : ["h2", "h3", "h4", "p", "li"].includes(block.tag) ? block.tag : "p";
    content += `<${tag} class="article-block">${escapeHtml(block.text)}</${tag}>`;
  }
  return content + (inList ? "</ul>" : "");
}

function renderArticleImages(article) {
  const tablePaths = new Set((article.tables || []).flatMap((table) => table.rows.flatMap((row) => row.flatMap((cell) => (cell.images || []).map((image) => image.local_path)))));
  const images = (article.images || []).filter((image) => image.local_path && !tablePaths.has(image.local_path));
  if (!images.length) return "";
  return `<div class="article-gallery">${images.map((image) => `<img class="article-image" src="data/${escapeAttribute(image.local_path)}" alt="${escapeAttribute(image.alt || "")}" loading="lazy" />`).join("")}</div>`;
}

function renderArticleTables(article) {
  return (article.tables || [])
    .map(
      (table) => `
        <div class="table-scroll" role="region" aria-label="${t("table")}" tabindex="0"><table class="article-table">
          <tbody>
            ${table.rows
              .map(
                (row) => `
                  <tr>
                    ${row
                      .map((cell) => {
                        const tag = cell.tag === "th" ? "th" : "td";
                        const image = cell.images?.[0]?.local_path
                          ? `<div><img class="article-image" src="data/${escapeAttribute(cell.images[0].local_path)}" alt="${escapeAttribute(cell.images[0].alt || "")}" loading="lazy" /></div>`
                          : "";
                        return `<${tag}>${escapeHtml(cell.text)}${image}</${tag}>`;
                      })
                      .join("")}
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table></div>
      `,
    )
    .join("");
}

async function renderLocationsAsync() {
  if (!state.locations) state.locations = await fetchJson("data/locations.json");
  render();
}

function renderLocations() {
  if (!state.locations) {
    renderLocationsAsync().catch(showError);
    return `<div class="loading">${t("loading")}</div>`;
  }

  return `
    <section class="page-head">
      <div>
        <p class="page-kicker">${t("locationsKicker")}</p>
        <h1 class="page-title">${t("locations")}</h1>
        <p class="page-copy">${t("locationsCopy")}</p>
      </div>
    </section>
    <section class="toolbar">
      <input class="search" type="search" data-location-search value="${escapeAttribute(state.search)}" placeholder="${t("search")}" aria-label="${t("search")}" />
    </section>
    <section class="locations-list">
      ${renderLocationResults()}
    </section>
  `;
}

function renderLocationResults() {
  const keyword = state.search.trim().toLowerCase();
  return state.locations
    .filter((item) => !keyword || JSON.stringify(item).toLowerCase().includes(keyword))
    .map(renderLocation).join("") || `<div class="empty-state">${t("empty")}</div>`;
}

function renderLocation(item) {
  return `
    <article class="location-row">
      <h3>${escapeHtml(item.center.ja)} · ${escapeHtml(item.center.romaji)}</h3>
      <p>${escapeHtml(item.prefecture.ja)} · ${escapeHtml(item.prefecture.romaji)}</p>
      <p>${escapeHtml(item.address.ja)} · ${escapeHtml(item.address.romaji)}</p>
      ${item.google_maps_url ? `<p><a href="${escapeAttribute(item.google_maps_url)}" target="_blank" rel="noreferrer">${t("maps")}</a></p>` : ""}
    </article>
  `;
}

function bindEvents() {
  const languageMenu = document.querySelector(".language-menu");
  document.querySelectorAll("[data-locale]").forEach((button) => {
    button.addEventListener("click", () => {
      state.locale = button.dataset.locale;
      localStorage.setItem("mirai-menkyo-locale", state.locale);
      render();
      document.querySelector(".language-trigger")?.focus({ preventScroll: true });
    });
  });

  languageMenu?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      languageMenu.open = false;
      languageMenu.querySelector("summary").focus({ preventScroll: true });
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    languageMenu.open = true;
    const options = [...languageMenu.querySelectorAll("[data-locale]")];
    const current = options.indexOf(document.activeElement);
    let index = event.key === "ArrowUp" ? (current <= 0 ? options.length - 1 : current - 1) : (current + 1) % options.length;
    if (event.key === "Home") index = 0;
    if (event.key === "End") index = options.length - 1;
    options[index]?.focus({ preventScroll: true });
  });

  app.onclick = (event) => {
    if (languageMenu?.open && !languageMenu.contains(event.target)) languageMenu.open = false;
  };

  document.querySelector(".question-list")?.addEventListener("toggle", (event) => {
    if (event.target.isConnected) state.questionNavOpen = event.target.open;
  });

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const restoreHome = state.tab === "practice" && button.dataset.tab === "exams";
      state.tab = button.dataset.tab;
      state.currentArticle = null;
      render();
      window.scrollTo(0, restoreHome ? state.examHomeScroll : 0);
    });
  });

  document.querySelectorAll("[data-start-exam]").forEach((button) => {
    button.addEventListener("click", () => startExam(button.dataset.startExam).catch(showError));
  });

  document.querySelectorAll("[data-go-question]").forEach((button) => {
    button.addEventListener("click", () => {
      goToQuestion(Number(button.dataset.goQuestion));
    });
  });

  document.querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => answerCurrent(button.dataset.answer === "true"));
  });

  document.querySelectorAll("[data-choice-answer]").forEach((button) => {
    button.addEventListener("click", () => answerChoice(button.dataset.choiceAnswer));
  });

  document.querySelector("[data-prev-question]")?.addEventListener("click", () => {
    goToQuestion(state.currentQuestionIndex - 1);
  });

  document.querySelector("[data-next-question]")?.addEventListener("click", () => {
    goToQuestion(state.currentQuestionIndex + 1);
  });

  document.querySelector("[data-submit-exam]")?.addEventListener("click", scoreExam);
  document.querySelector("[data-back-exams]")?.addEventListener("click", () => {
    state.tab = "exams";
    render();
    window.scrollTo(0, state.examHomeScroll);
  });

  document.querySelectorAll("[data-open-article]").forEach((button) => {
    button.addEventListener("click", () => {
      state.knowledgeScroll = window.scrollY;
      state.currentArticle = button.dataset.openArticle;
      render();
      window.scrollTo(0, 0);
    });
  });

  document.querySelector("[data-close-article]")?.addEventListener("click", () => {
    state.currentArticle = null;
    render();
    window.scrollTo(0, state.knowledgeScroll);
  });

  document.querySelector("[data-knowledge-search]")?.addEventListener("input", (event) => {
    const cursor = event.target.selectionStart;
    state.knowledgeSearch = event.target.value;
    render();
    const input = document.querySelector("[data-knowledge-search]");
    input?.focus({ preventScroll: true });
    if (cursor !== null) input?.setSelectionRange(cursor, cursor);
  });

  const locationSearch = document.querySelector("[data-location-search]");
  const updateLocationSearch = (event) => {
    state.search = event.target.value;
    if (event.isComposing) return;
    document.querySelector(".locations-list").innerHTML = renderLocationResults();
  };
  locationSearch?.addEventListener("input", updateLocationSearch);
  locationSearch?.addEventListener("compositionend", updateLocationSearch);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function showError(error) {
  app.innerHTML = renderShell(`<div class="error">${escapeHtml(error.message)}</div>`);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
