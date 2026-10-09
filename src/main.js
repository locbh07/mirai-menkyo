import { languages, languageFlags, translate } from "./i18n.js";
import { icon } from "./icons.js";
import { dataConfig } from "./data-config.js";
import { decodeJsonData } from "./data-codec.js";
import { installShortcutDeterrent } from "./shortcut-deterrent.js";
import { createDevtoolsGuard } from "./devtools-guard.js";
import { renderPdfArticle, installPdfImageViewer } from "./pdf-lessons.js";

installShortcutDeterrent();
installPdfImageViewer();

const storedLocale = localStorage.getItem("mirai-menkyo-locale");
const state = {
  locale: languages[storedLocale] ? storedLocale : "vi",
  questionNavOpen: false,
  tab: "exams",
  manifest: null,
  examHomeScroll: 0,
  currentExam: null,
  currentQuestionIndex: 0,
  currentChoiceIndex: 0,
  answers: {},
  submitted: false,
  result: null,
  timerId: null,
  advanceTimer: null,
  secondsLeft: 0,
  knowledge: null,
  knowledgeSearch: "",
  knowledgeLanguage: null,
  knowledgeScope: "quick",
  knowledgeGroup: "",
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
let questionObserver;
const accessGuard = createDevtoolsGuard({
  getLocale: () => state.locale,
  onBlockChange: () => {
    clearAutoAdvance();
    if (state.manifest) render();
  },
});

init();

async function init() {
  app.innerHTML = renderShell(`<div class="loading">${t("loading")}</div>`);
  try {
    state.manifest = await fetchJson(dataConfig.manifestPath);
    if (!state.manifest.locales?.includes(state.locale)) state.locale = state.manifest.locale;
    render();
  } catch (error) {
    showError(new Error(`${t("loadError")}: ${error.message}`));
  }
}

function render() {
  questionObserver?.disconnect();
  if (state.tab !== "practice") state.questionNavOpen = false;
  if (state.tab !== "practice" || state.submitted) clearAutoAdvance();
  const oldNav = document.querySelector(".question-nav");
  const oldBody = document.querySelector(".question-body");
  const bodyScroll = oldBody && oldBody.dataset.questionId === state.currentExam?.questions[state.currentQuestionIndex]?.id && oldBody.dataset.choiceIndex === String(state.currentChoiceIndex)
    ? questionScrollArea(oldBody).scrollTop : 0;
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
  const newBody = document.querySelector(".question-body");
  if (newBody) {
    questionObserver = new ResizeObserver(() => fitQuestionBody(newBody));
    questionObserver.observe(newBody);
    newBody.querySelectorAll(".question-images img").forEach((image) => image.addEventListener("load", () => fitQuestionBody(newBody)));
    questionScrollArea(newBody).scrollTop = bodyScroll;
  }
  const newNav = document.querySelector(".question-nav");
  if (newNav) {
    newNav.querySelector(".question-list").scrollTop = navScroll[0];
    newNav.querySelector(".question-dots").scrollTop = navScroll[1];
  }
}

function fitQuestionBody(body) {
  if (!body.isConnected) return;
  // Reclaim space before allowing inner scrolling; never truncate translated questions.
  body.classList.remove("compact-copy", "stepped-choices");
  const images = body.querySelector(".question-images");
  if (images && [...images.children].every((image) => image.naturalWidth > 0)) {
    const width = (images.clientWidth - 12 * (images.children.length - 1)) / images.children.length;
    const height = Math.max(...[...images.children].map((image) => width * image.naturalHeight / image.naturalWidth));
    images.style.setProperty("--image-natural-height", `${height}px`);
  }
  body.querySelectorAll(".choice-item").forEach((item) => { item.hidden = false; });
  const readingArea = questionScrollArea(body);
  if (body.classList.contains("has-choices") && readingArea.scrollHeight > readingArea.clientHeight + 1) body.classList.add("stepped-choices");
  if (body.classList.contains("has-choices")) updateChoiceStep();
  if (readingArea.scrollHeight > readingArea.clientHeight + 1) body.classList.add("compact-copy");
  body.dataset.layoutReady = "true";
}

function questionScrollArea(body) {
  const copy = body.querySelector(".question-copy");
  return getComputedStyle(copy).display === "contents" ? body : copy;
}

function renderShell(content) {
  document.documentElement.lang = state.locale;
  document.title = `Mirai Menkyo - ${t("homeTitle")}`;
  return `
    <div class="app-shell ${state.tab === "practice" ? "practice-shell" : ""}">
      ${state.tab === "practice" ? "" : `<header class="topbar">
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
      </header>`}
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
  state.questionNavOpen = false;
  state.currentQuestionIndex = 0;
  state.currentChoiceIndex = 0;
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
      <aside class="question-nav" id="question-navigation" aria-label="${t("questionList")}" data-exam-id="${escapeAttribute(exam.id)}" ${state.questionNavOpen ? "" : "hidden"}>
        <div class="exam-header">
          <div class="drawer-heading">
            <strong>${escapeHtml(examTitle(exam))}</strong>
            <button class="icon-button" data-close-questions aria-label="${t("back")}" data-tooltip="${t("back")}">${icon("x")}</button>
          </div>
          <span>${t("count", { count: exam.questions.length })}</span>
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
          <div class="practice-toolbar-left">
            <button class="icon-button" data-back-exams aria-label="${t("examList")}" data-tooltip="${t("examList")}">${icon("chevron-left")}</button>
            <span class="practice-exam-title">${escapeHtml(examTitle(exam))}</span>
          </div>
          <span class="timer" role="timer" aria-label="${t("examMeta", { count: exam.questions.length, minutes: exam.type === "honmen" ? 50 : 30 })}">${formatTime(state.secondsLeft)}</span>
          <div class="practice-toolbar-right">
            <button class="icon-button" data-toggle-questions aria-controls="question-navigation" aria-expanded="${state.questionNavOpen}" aria-label="${t("questionList")}" data-tooltip="${t("questionList")}">${icon("list")}</button>
            <details class="practice-menu">
              <summary class="icon-button" aria-label="${t("navigation")}" data-tooltip="${t("navigation")}">${icon("menu")}</summary>
              <div class="practice-menu-content">
                <strong>Mirai Menkyo</strong>
                <nav class="nav-tabs" aria-label="${t("navigation")}">
                  ${tabButton("exams", t("exams"))}
                  ${tabButton("knowledge", t("knowledge"))}
                  ${tabButton("locations", t("locations"))}
                </nav>
                ${renderLanguageMenu()}
              </div>
            </details>
          </div>
        </div>
        ${state.result ? renderResult() : ""}
        <div class="question-body ${question.imagePaths?.length ? "has-images" : ""} ${question.choices.length ? "has-choices" : ""}" data-question-id="${escapeAttribute(question.id)}" data-choice-index="${state.currentChoiceIndex}">
          ${renderQuestionImages(question)}
          <div class="question-copy">
            <h2 class="question-title" tabindex="-1">${t("question", { number: state.currentQuestionIndex + 1 })}. ${escapeHtml(localizedText(question))}</h2>
            ${question.choices.length ? renderChoiceQuestion(question) : ""}
            ${state.submitted && localizedText(question, "explanation") ? `<div class="explanation"><strong>${t("explanation")}:</strong> ${escapeHtml(localizedText(question, "explanation"))}</div>` : ""}
          </div>
        </div>
        ${question.choices.length ? "" : renderTrueFalseQuestion(question)}
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
  return `<button class="answer-button ${cls}" data-answer="${value}" aria-pressed="${selected}" ${state.advanceTimer !== null ? "disabled" : ""}><span>${label}</span></button>`;
}

function renderChoiceQuestion(question) {
  const selected = state.answers[question.id] || {};
  return `
    <div class="choice-list">
      <div class="choice-step-tabs" role="tablist" aria-label="${t("question", { number: state.currentQuestionIndex + 1 })}">
        ${question.choices.map((choice, index) => `<button class="choice-step ${index === state.currentChoiceIndex ? "active" : ""}" role="tab" id="tab-${escapeAttribute(question.id)}-${index}" aria-controls="choice-${escapeAttribute(question.id)}-${index}" aria-selected="${index === state.currentChoiceIndex}" aria-label="${t("statement", { number: index + 1 })}" tabindex="${index === state.currentChoiceIndex ? 0 : -1}" data-choice-step="${index}">${index + 1}${typeof selected[choice.number] === "boolean" ? icon("check") : ""}</button>`).join("")}
      </div>
      ${question.choices
        .map(
          (choice, index) => `
            <div class="choice-item" id="choice-${escapeAttribute(question.id)}-${index}" data-choice-index="${index}">
              <div class="choice-text" tabindex="-1">${escapeHtml(localizedText(choice))}</div>
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
  return `<button class="answer-button ${cls}" data-choice-answer="${choice.number}:${value}" aria-pressed="${selected}" ${state.advanceTimer !== null ? "disabled" : ""}><span>${t(value ? "correct" : "incorrect")}</span></button>`;
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
  state.questionNavOpen = false;
  const question = state.currentExam.questions[state.currentQuestionIndex];
  state.answers[question.id] = { value };
  advanceAfterAnswer(question);
  render();
}

function answerChoice(raw) {
  if (state.advanceTimer !== null) return;
  state.questionNavOpen = false;
  const [choiceNumber, value] = raw.split(":");
  const question = state.currentExam.questions[state.currentQuestionIndex];
  state.answers[question.id] = {
    ...(state.answers[question.id] || {}),
    [choiceNumber]: value === "true",
  };
  if (isQuestionAnswered(question)) advanceAfterAnswer(question);
  else if (!state.submitted && document.querySelector(".question-body").classList.contains("stepped-choices")) {
    const examId = state.currentExam.id;
    state.advanceTimer = setTimeout(() => {
      state.advanceTimer = null;
      if (state.tab !== "practice" || state.submitted || state.currentExam?.id !== examId || state.currentExam.questions[state.currentQuestionIndex]?.id !== question.id) return;
      state.currentChoiceIndex = question.choices.findIndex((choice) => typeof state.answers[question.id]?.[choice.number] !== "boolean");
      render();
      document.querySelector(`.choice-item[data-choice-index="${state.currentChoiceIndex}"] .choice-text`)?.focus({ preventScroll: true });
    }, 250);
  }
  render();
}

function updateChoiceStep() {
  const body = document.querySelector(".question-body");
  const stepped = body.classList.contains("stepped-choices");
  body.querySelectorAll(".choice-item").forEach((item, index) => {
    item.hidden = stepped && index !== state.currentChoiceIndex;
    if (stepped) {
      item.setAttribute("role", "tabpanel");
      item.setAttribute("aria-labelledby", `tab-${body.dataset.questionId}-${index}`);
    } else {
      item.removeAttribute("role");
      item.removeAttribute("aria-labelledby");
    }
  });
  body.querySelectorAll("[data-choice-step]").forEach((button, index) => {
    const active = index === state.currentChoiceIndex;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  body.dataset.choiceIndex = String(state.currentChoiceIndex);
}

function goChoiceStep(index) {
  clearAutoAdvance();
  state.currentChoiceIndex = index;
  fitQuestionBody(document.querySelector(".question-body"));
  document.querySelectorAll("[data-choice-answer]").forEach((button) => { button.disabled = false; });
  questionScrollArea(document.querySelector(".question-body")).scrollTop = 0;
  document.querySelector(`[data-choice-step="${index}"]`).focus({ preventScroll: true });
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
    state.currentChoiceIndex = 0;
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
  if (!heading?.isConnected || accessGuard.blocked || state.tab !== "practice" || state.submitted || state.advanceTimer !== null || state.currentExam?.id !== examId || state.currentExam.questions[state.currentQuestionIndex]?.id !== questionId) return;
  heading.focus({ preventScroll: true });
  questionScrollArea(document.querySelector(".question-body")).scrollTop = 0;
}

function goToQuestion(index) {
  clearAutoAdvance();
  state.questionNavOpen = false;
  state.currentQuestionIndex = Math.min(state.currentExam.questions.length - 1, Math.max(0, index));
  state.currentChoiceIndex = 0;
  render();
  document.querySelector(".question-title")?.focus({ preventScroll: true });
}

function scoreExam() {
  clearAutoAdvance();
  state.questionNavOpen = false;
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
    if (accessGuard.blocked) return;
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
  if (!state.knowledge) state.knowledge = await fetchJson(state.manifest.knowledgePath);
  render();
}

function knowledgeLocale() {
  return state.knowledgeLanguage || (state.manifest.knowledgeLocales?.includes(state.locale)
    ? state.locale : state.manifest.knowledgeFallbackLocale || "ja");
}

function knowledgeArticles() {
  const language = knowledgeLocale();
  return (state.knowledge || []).filter((article) => {
    if ((article.locale || "vi") !== language) return false;
    if (language !== "vi") return true;
    if (state.knowledgeScope === "quick") return article.format === "quick-review-v1" || article.currentLaw;
    return article.format === "pdf-lessons-v1" || article.currentLaw;
  });
}

function knowledgeScopeUi() {
  if (state.locale === "ja") return { quick: "要点復習", detail: "詳細教材", notice: "ベトナム語では要点復習と詳細教材を切り替えられます。翻訳・編集は非公式です。" };
  if (state.locale === "en") return { quick: "Quick review", detail: "Detailed lessons", notice: "Quick review is compiled from the official manual. Detailed lessons preserve its chapters, appendices and colored reference illustrations. Translation and editing are unofficial." };
  return { quick: "Ôn nhanh", detail: "Giáo trình chi tiết", notice: "Ôn nhanh được biên soạn lại từ PDF chính thức. Giáo trình chi tiết giữ nguyên cấu trúc chương, phụ biểu và hình màu tham khảo. Bản dịch/biên tập không chính thức; quy định mới được rà soát đến 08/10/2026." };
}

function knowledgeUi() {
  if (state.locale === "ja") return { exam: "試験対策", reference: "全文資料", notice: "試験対策を優先表示しています。全文資料には2024年版原文、付録、改正履歴も含まれます。翻訳・編集は非公式です。" };
  if (state.locale === "en") return { exam: "Exam study", reference: "Full reference", notice: "Exam-focused lessons are shown first. Full reference also contains the 2024 source, appendices and amendment history. Translation and editing are unofficial." };
  return { exam: "Học để thi", reference: "Tài liệu đầy đủ", notice: "Mặc định chỉ hiển thị nội dung phục vụ học và thi. Tài liệu đầy đủ còn chứa bản gốc 2024, phụ lục và lịch sử sửa đổi. Bản dịch/biên tập không chính thức; quy định mới được rà soát đến 08/10/2026." };
}

function knowledgeResults() {
  const keyword = normalizeSearch(state.knowledgeSearch);
  return knowledgeArticles().filter((article) => (!state.knowledgeGroup || article.group?.id === state.knowledgeGroup)
    && normalizeSearch(`${article.group?.title || ""} ${article.title} ${article.text || ""}`).includes(keyword));
}

function renderKnowledgeSections(articles) {
  if (!articles.length) return `<div class="empty-state">${t("empty")}</div>`;
  const groups = new Map();
  for (const article of articles) {
    const key = article.group?.id || "legacy";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(article);
  }
  return [...groups.values()].map((items) => `<section class="knowledge-section">
    ${items[0].group ? `<h2 class="knowledge-section-title" lang="${items[0].locale}">${escapeHtml(items[0].group.title)}</h2>` : `<h2 class="knowledge-section-title">${t("additionalKnowledge")}</h2>`}
    <div class="knowledge-list">${items.map(renderKnowledgeRow).join("")}</div></section>`).join("");
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

  const language = knowledgeLocale();
  const ui = knowledgeScopeUi();
  const catalog = knowledgeArticles();
  const groups = [...new Map(catalog.filter((article) => article.group).map((article) => [article.group.id, article.group])).values()];
  const articles = knowledgeResults();
  return `
    <section class="page-head knowledge-head">
      <div>
        <p class="page-kicker">${t("knowledgeKicker")}</p>
        <h1 class="page-title">${t("knowledgeTitle")}</h1>
        <p class="page-copy">${t("knowledgeCopy")}</p>
        ${state.locale !== language ? `<p class="content-language">${t("contentLanguage", { language: languages[language] })}</p>` : ""}
        ${language === "ja" ? '<p class="pdf-source-version" lang="ja">2024年版「交通の方法に関する教則」・原文の内容と図を掲載</p>' : ""}
        <p class="knowledge-legal-notice">${escapeHtml(ui.notice)}</p>
      </div>
      <span class="knowledge-count">${t("knowledgeCount", { count: catalog.length })}</span>
    </section>
    <div class="knowledge-toolbar">
      ${language === "vi" ? `<select class="knowledge-select" data-knowledge-scope aria-label="${escapeAttribute(ui.quick)}"><option value="quick" ${state.knowledgeScope === "quick" ? "selected" : ""}>${escapeHtml(ui.quick)}</option><option value="detail" ${state.knowledgeScope === "detail" ? "selected" : ""}>${escapeHtml(ui.detail)}</option></select>` : ""}
      <select class="knowledge-select" data-knowledge-language aria-label="${t("language")}">${(state.manifest.knowledgeLocales || ["vi"]).map((locale) => `<option value="${locale}" ${locale === language ? "selected" : ""}>${escapeHtml(languages[locale])}</option>`).join("")}</select>
      ${groups.length ? `<select class="knowledge-select knowledge-chapter-select" data-knowledge-group aria-label="${t("knowledgeTitle")}"><option value="">${t("all")}</option>${groups.map((group) => `<option value="${group.id}" ${state.knowledgeGroup === group.id ? "selected" : ""}>${escapeHtml(group.title)}</option>`).join("")}</select>` : ""}
      <input class="search knowledge-search" type="search" data-knowledge-search value="${escapeAttribute(state.knowledgeSearch)}" placeholder="${t("knowledgeSearch")}" aria-label="${t("knowledgeSearch")}" />
      <span class="knowledge-results" aria-live="polite">${t("knowledgeCount", { count: articles.length })}</span>
    </div>
    <div class="knowledge-sections" aria-label="${t("knowledgeTitle")}">${renderKnowledgeSections(articles)}</div>
  `;
}

function normalizeSearch(value) {
  return String(value || "").normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
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
  const index = knowledgeArticles().indexOf(article) + 1;
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
  if (article.format === "pdf-lessons-v1") return renderPdfArticle(article, state.manifest.knowledgeSources.ja, (state.knowledge || []).filter((item) => item.locale === article.locale && item.format === "pdf-lessons-v1"), t("back"));
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
      ${renderRelatedArticles(article)}
      ${article.sourceUrl ? `<footer class="pdf-attribution">Nguồn chính thức: <a href="${escapeAttribute(article.sourceUrl)}" target="_blank" rel="noopener noreferrer">Cơ quan Cảnh sát Quốc gia Nhật Bản ${icon("external-link")}</a><br />Bản dịch/biên tập không chính thức của Mirai Menkyo.</footer>` : ""}
      </div>
    </section>
  `;
}

function renderRelatedArticles(article) {
  if (!article.relatedArticleIds?.length) return "";
  const groups = new Map();
  for (const id of article.relatedArticleIds) {
    const target = state.knowledge.find((item) => item.id === id);
    if (!target) continue;
    const key = target.currentLaw ? "current-law" : target.group?.id || "reference";
    const title = target.currentLaw
      ? "Quy định cập nhật sau PDF 2024"
      : target.group?.title || "Tài liệu tham khảo";
    if (!groups.has(key)) groups.set(key, { title, articles: [] });
    groups.get(key).articles.push(target);
  }
  if (!groups.size) return "";
  return `<section class="quick-related"><h2>Xem chi tiết trong giáo trình</h2>
    <div class="quick-related-groups">${[...groups.values()].map((group) => `<section class="quick-related-group">
      <h3>${escapeHtml(group.title)}</h3>
      <div>${group.articles.map((target) => `<button class="button secondary" data-open-article="${escapeAttribute(target.id)}">${escapeHtml(target.title)}</button>`).join("")}</div>
    </section>`).join("")}</div>
  </section>`;
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
      (table, index) => article.slug === "traffic-signs" ? renderTrafficSignTable(table, index) : `
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

function renderTrafficSignTable(table, tableIndex) {
  return `
    <div class="table-scroll" role="region" aria-label="${t("table")}" tabindex="0">
      <table class="article-table traffic-sign-table">
        <colgroup><col class="sign-image-column" /><col /></colgroup>
        ${table.rows.map((row, rowIndex) => {
          if (row.length === 1) {
            return `<tbody class="sign-section"><tr><th colspan="2" scope="colgroup">${escapeHtml(row[0].text)}</th></tr></tbody>`;
          }
          const [sign, description] = row;
          const titleId = `sign-title-${tableIndex}-${rowIndex}`;
          return `
            <tbody class="sign-entry">
              <tr class="sign-heading">
                <td class="sign-image-cell" rowspan="2">${(sign.images || []).filter((image) => image.local_path).map((image) => `<img class="article-image" src="data/${escapeAttribute(image.local_path)}" alt="${escapeAttribute(image.alt || sign.text)}" loading="lazy" />`).join("")}</td>
                <th class="sign-title" id="${titleId}" scope="rowgroup">${escapeHtml(sign.text)}</th>
              </tr>
              <tr class="sign-description"><td headers="${titleId}">${escapeHtml(description.text)}</td></tr>
            </tbody>
          `;
        }).join("")}
      </table>
    </div>
  `;
}

async function renderLocationsAsync() {
  if (!state.locations) state.locations = await fetchJson(state.manifest.locationsPath);
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
  const outline = document.querySelector(".pdf-outline details");
  if (outline) outline.open = matchMedia("(min-width: 901px)").matches;
  const practiceMenu = document.querySelector(".practice-menu");
  const languageMenu = document.querySelector(".language-menu");
  document.querySelectorAll("[data-locale]").forEach((button) => {
    button.addEventListener("click", () => {
      const current = state.knowledge?.find((article) => article.id === state.currentArticle);
      state.locale = button.dataset.locale;
      state.knowledgeLanguage = null;
      if (current?.sourceArticleId) state.currentArticle = knowledgeArticles().find((article) => article.sourceArticleId === current.sourceArticleId)?.id || null;
      localStorage.setItem("mirai-menkyo-locale", state.locale);
      render();
      const languageFocus = state.tab === "practice"
        ? document.querySelector(".practice-menu > summary") : document.querySelector(".language-trigger");
      languageFocus?.focus({ preventScroll: true });
    });
  });

  languageMenu?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
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
    if (!event.target.isConnected) return;
    if (languageMenu?.open && !languageMenu.contains(event.target)) languageMenu.open = false;
    if (practiceMenu?.open && !practiceMenu.contains(event.target)) practiceMenu.open = false;
    if (state.questionNavOpen && !event.target.closest(".question-nav,[data-toggle-questions]")) toggleQuestionNav(false, false);
  };

  app.onkeydown = (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (languageMenu?.open) return;
    if (practiceMenu?.open) {
      practiceMenu.open = false;
      practiceMenu.querySelector("summary").focus({ preventScroll: true });
    } else if (state.questionNavOpen) toggleQuestionNav(false);
  };

  document.querySelector("[data-toggle-questions]")?.addEventListener("click", () => toggleQuestionNav(!state.questionNavOpen));
  document.querySelector("[data-close-questions]")?.addEventListener("click", () => toggleQuestionNav(false));

  document.querySelector(".question-list")?.addEventListener("toggle", (event) => {
    if (event.target.isConnected && state.questionNavOpen !== event.target.open) toggleQuestionNav(event.target.open);
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

  document.querySelectorAll("[data-choice-step]").forEach((button) => {
    button.addEventListener("click", () => goChoiceStep(Number(button.dataset.choiceStep)));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const count = state.currentExam.questions[state.currentQuestionIndex].choices.length;
      const index = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (state.currentChoiceIndex + (event.key === "ArrowRight" ? 1 : -1) + count) % count;
      goChoiceStep(index);
    });
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

  function openArticle(button, fromList) {
    if (fromList) state.knowledgeScroll = window.scrollY;
    state.currentArticle = button.dataset.openArticle || button.dataset.pdfArticle;
    render();
    window.scrollTo(0, 0);
    const heading = document.querySelector(".article-view h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }
  document.querySelectorAll("[data-pdf-article]").forEach((button) => button.addEventListener("click", () => openArticle(button, false)));
  document.querySelectorAll("[data-open-article]").forEach((button) => {
    button.addEventListener("click", () => {
      openArticle(button, true);
    });
  });

  document.querySelector("[data-close-article]")?.addEventListener("click", () => {
    state.currentArticle = null;
    render();
    window.scrollTo(0, state.knowledgeScroll);
  });

  document.querySelector("[data-knowledge-language]")?.addEventListener("change", (event) => {
    state.knowledgeLanguage = event.target.value;
    state.knowledgeGroup = "";
    state.knowledgeSearch = "";
    state.knowledgeScroll = 0;
    render();
  });
  document.querySelector("[data-knowledge-scope]")?.addEventListener("change", (event) => {
    state.knowledgeScope = event.target.value;
    state.knowledgeGroup = "";
    state.knowledgeSearch = "";
    state.knowledgeScroll = 0;
    render();
  });
  document.querySelector("[data-knowledge-group]")?.addEventListener("change", (event) => {
    state.knowledgeGroup = event.target.value;
    document.querySelector(".knowledge-sections").innerHTML = renderKnowledgeSections(knowledgeResults());
    bindKnowledgeRows();
    document.querySelector(".knowledge-results").textContent = t("knowledgeCount", { count: knowledgeResults().length });
  });
  function bindKnowledgeRows() {
    document.querySelectorAll("[data-open-article]").forEach((button) => button.addEventListener("click", () => openArticle(button, true)));
  }
  const knowledgeSearch = document.querySelector("[data-knowledge-search]");
  const updateKnowledgeSearch = (event) => {
    state.knowledgeSearch = event.target.value;
    if (event.isComposing) return;
    const results = knowledgeResults();
    document.querySelector(".knowledge-sections").innerHTML = renderKnowledgeSections(results);
    bindKnowledgeRows();
    document.querySelector(".knowledge-results").textContent = t("knowledgeCount", { count: results.length });
  };
  knowledgeSearch?.addEventListener("input", updateKnowledgeSearch);
  knowledgeSearch?.addEventListener("compositionend", updateKnowledgeSearch);

  const locationSearch = document.querySelector("[data-location-search]");
  const updateLocationSearch = (event) => {
    state.search = event.target.value;
    if (event.isComposing) return;
    document.querySelector(".locations-list").innerHTML = renderLocationResults();
  };
  locationSearch?.addEventListener("input", updateLocationSearch);
  locationSearch?.addEventListener("compositionend", updateLocationSearch);
}

function toggleQuestionNav(open, restoreFocus = true) {
  state.questionNavOpen = open;
  const nav = document.querySelector(".question-nav");
  const trigger = document.querySelector("[data-toggle-questions]");
  if (!nav || !trigger) return;
  nav.hidden = !open;
  nav.querySelector(".question-list").open = open;
  trigger.setAttribute("aria-expanded", String(open));
  if (open) {
    document.querySelector(".practice-menu").open = false;
    nav.querySelector(".dot.current")?.focus({ preventScroll: true });
  } else if (restoreFocus) {
    trigger.focus({ preventScroll: true });
  }
}

async function fetchJson(url, options) {
  await accessGuard.waitUntilAllowed();
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  try {
    return await decodeJsonData(await response.arrayBuffer(), dataConfig.keyBase64);
  } catch {
    throw new Error(t("dataReload"));
  }
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
