const state = {
  tab: "exams",
  manifest: null,
  examsByType: "all",
  currentExam: null,
  currentQuestionIndex: 0,
  answers: {},
  submitted: false,
  result: null,
  timerId: null,
  secondsLeft: 0,
  knowledge: null,
  currentArticle: null,
  locations: null,
  search: "",
};

const examTypeLabels = {
  all: "Tất cả",
  karimen: "Karimen",
  honmen: "Honmen",
  gentsuki: "Xe gắn máy",
};

const app = document.querySelector("#app");

init();

async function init() {
  app.innerHTML = renderShell("<div class=\"loading\">Đang tải dữ liệu...</div>");
  try {
    state.manifest = await fetchJson("data/manifest.json");
    render();
  } catch (error) {
    app.innerHTML = renderShell(`<div class="error">Không tải được dữ liệu: ${escapeHtml(error.message)}</div>`);
  }
}

function render() {
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
}

function renderShell(content) {
  return `
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <div class="brand-mark">M</div>
            <div>
              <div class="brand-name">Mirai Menkyo</div>
              <div class="brand-subtitle">Karimen · Honmen · Gentsuki</div>
            </div>
          </div>
          <nav class="nav-tabs" aria-label="Điều hướng">
            ${tabButton("exams", "Đề thi")}
            ${tabButton("knowledge", "Kiến thức")}
            ${tabButton("locations", "Địa điểm thi")}
          </nav>
          <div class="top-actions">
            <span class="premium-chip">Premium sắp mở</span>
          </div>
        </div>
      </header>
      <main class="main">${content}</main>
    </div>
  `;
}

function tabButton(tab, label) {
  const active = state.tab === tab || (tab === "exams" && state.tab === "practice");
  return `<button class="tab-button ${active ? "active" : ""}" data-tab="${tab}">${label}</button>`;
}

function renderExamHome() {
  const exams = filteredExams();
  const stats = state.manifest.stats;
  return `
    <section class="page-head">
      <div>
        <p class="page-kicker">Bằng lái Nhật Bản</p>
        <h1 class="page-title">Luyện đề sáng rõ, vào bài thật nhanh.</h1>
        <p class="page-copy">
          Bộ đề Karimen, Honmen và xe gắn máy bằng tiếng Việt, kèm hình ảnh, giải thích và dữ liệu địa điểm thi.
        </p>
      </div>
      <div class="stats">
        ${stat(stats.examSets, "bộ đề")}
        ${stat(stats.examQuestions, "câu hỏi")}
        ${stat(stats.knowledgeArticles, "bài học")}
      </div>
    </section>
    <section class="toolbar">
      <div class="segmented">
        ${Object.keys(examTypeLabels)
          .map((type) => `<button class="segment ${state.examsByType === type ? "active" : ""}" data-exam-filter="${type}">${examTypeLabels[type]}</button>`)
          .join("")}
      </div>
    </section>
    <section class="exam-grid">
      ${exams
        .map(
          (exam) => `
            <button class="exam-card ${exam.type}" data-start-exam="${exam.id}">
              <span class="exam-type">${escapeHtml(examTypeLabels[exam.type])}</span>
              <span class="exam-title">${escapeHtml(exam.title)}</span>
              <span class="exam-meta">${exam.questionCount} câu · ${exam.type === "honmen" ? "50 phút" : "30 phút"}</span>
              <span class="card-bottom">
                <span class="score-pill">${savedScore(exam.id)}</span>
                <span class="start-pill">Bắt đầu</span>
              </span>
            </button>
          `,
        )
        .join("")}
    </section>
  `;
}

function stat(value, label) {
  return `<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
}

function filteredExams() {
  const exams = state.manifest?.exams || [];
  return exams.filter((exam) => state.examsByType === "all" || exam.type === state.examsByType);
}

async function startExam(id) {
  const item = state.manifest.exams.find((exam) => exam.id === id);
  if (!item) return;
  state.currentExam = await fetchJson(item.path);
  state.currentQuestionIndex = 0;
  state.answers = {};
  state.submitted = false;
  state.result = null;
  state.secondsLeft = state.currentExam.timeLimitSeconds;
  state.tab = "practice";
  startTimer();
  render();
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
      <aside class="question-nav">
        <div class="exam-header">
          <strong>${escapeHtml(exam.title)}</strong>
          <div class="timer-row">
            <span>${exam.questions.length} câu</span>
            <span class="timer">${formatTime(state.secondsLeft)}</span>
          </div>
          ${state.result ? renderResult() : ""}
        </div>
        <div class="question-dots">
          ${exam.questions.map((item, index) => renderDot(item, index)).join("")}
        </div>
      </aside>
      <section class="question-panel">
        <h2 class="question-title">Câu ${state.currentQuestionIndex + 1}. ${escapeHtml(question.text)}</h2>
        ${renderQuestionImages(question)}
        ${question.choices.length ? renderChoiceQuestion(question) : renderTrueFalseQuestion(question)}
        ${state.submitted && question.explanation ? `<div class="explanation"><strong>Giải thích:</strong> ${escapeHtml(question.explanation)}</div>` : ""}
        <div class="question-footer">
          <div>
            <button class="button secondary" data-prev-question ${state.currentQuestionIndex === 0 ? "disabled" : ""}>Trước</button>
            <button class="button secondary" data-next-question ${state.currentQuestionIndex === exam.questions.length - 1 ? "disabled" : ""}>Sau</button>
          </div>
          <div>
            <button class="button secondary" data-back-exams>Danh sách đề</button>
            <button class="button warn" data-submit-exam>${state.submitted ? "Chấm lại" : "Chấm điểm"}</button>
          </div>
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
        .map((imagePath) => `<img src="data/${escapeAttribute(imagePath)}" alt="Hình câu ${question.number}" loading="lazy" />`)
        .join("")}
    </div>
  `;
}

function renderTrueFalseQuestion(question) {
  const answer = state.answers[question.id]?.value;
  return `
    <div class="answer-actions">
      ${answerButton(question, true, "Đúng", answer === true)}
      ${answerButton(question, false, "Sai", answer === false)}
    </div>
  `;
}

function answerButton(question, value, label, selected) {
  let cls = selected ? "selected" : "";
  if (state.submitted) {
    if (value === question.correct) cls = "correct";
    else if (selected) cls = "incorrect";
  }
  return `<button class="answer-button ${cls}" data-answer="${value}">${label}</button>`;
}

function renderChoiceQuestion(question) {
  const selected = state.answers[question.id] || {};
  return `
    <div class="choice-list">
      ${question.choices
        .map(
          (choice) => `
            <div class="choice-item">
              <div class="choice-text">${escapeHtml(choice.text)}</div>
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
  return `<button class="answer-button ${cls}" data-choice-answer="${choice.number}:${value}">${value ? "Đúng" : "Sai"}</button>`;
}

function renderDot(question, index) {
  let cls = "";
  if (index === state.currentQuestionIndex) cls += " current";
  if (state.answers[question.id]) cls += " answered";
  if (state.submitted) cls += isQuestionCorrect(question) ? " good" : " bad";
  return `<button class="dot ${cls}" data-go-question="${index}">${index + 1}</button>`;
}

function renderResult() {
  const result = state.result;
  return `
    <div class="result-box">
      <p class="result-score">${result.score}/${result.total}</p>
      <p>${result.passed ? "Đạt mốc 90 điểm." : "Chưa đạt mốc 90 điểm."}</p>
    </div>
  `;
}

function answerCurrent(value) {
  const question = state.currentExam.questions[state.currentQuestionIndex];
  state.answers[question.id] = { value };
  render();
}

function answerChoice(raw) {
  const [choiceNumber, value] = raw.split(":");
  const question = state.currentExam.questions[state.currentQuestionIndex];
  state.answers[question.id] = {
    ...(state.answers[question.id] || {}),
    [choiceNumber]: value === "true",
  };
  render();
}

function scoreExam() {
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
  return localStorage.getItem(`mirai-menkyo-score:${id}`) || "Chưa làm";
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
    return "<div class=\"loading\">Đang tải kiến thức...</div>";
  }

  if (state.currentArticle) {
    const article = state.knowledge.find((item) => item.id === state.currentArticle);
    if (!article) state.currentArticle = null;
    else return renderArticle(article);
  }

  return `
    <section class="page-head">
      <div>
        <p class="page-kicker">Ôn tập nền tảng</p>
        <h1 class="page-title">Kiến thức cơ bản</h1>
        <p class="page-copy">Biển báo, tốc độ, quy định dừng đỗ, khoảng cách dừng xe và các chủ đề hay gặp trong bài thi.</p>
      </div>
    </section>
    <section class="article-grid">
      ${state.knowledge
        .map(
          (article) => `
            <button class="article-card" data-open-article="${article.id}">
              <h3>${escapeHtml(article.title)}</h3>
              <p>${escapeHtml((article.text || "").slice(0, 130))}...</p>
            </button>
          `,
        )
        .join("")}
    </section>
  `;
}

function renderArticle(article) {
  return `
    <section class="article-view">
      <button class="button secondary" data-close-article>Quay lại</button>
      <h1>${escapeHtml(article.title)}</h1>
      ${renderArticleBlocks(article)}
      ${renderArticleTables(article)}
    </section>
  `;
}

function renderArticleBlocks(article) {
  return (article.blocks || [])
    .slice(0, 80)
    .map((block) => {
      const tag = ["h1", "h2", "h3", "h4", "p", "li"].includes(block.tag) ? block.tag : "p";
      return `<${tag} class="article-block">${escapeHtml(block.text)}</${tag}>`;
    })
    .join("");
}

function renderArticleTables(article) {
  return (article.tables || [])
    .map(
      (table) => `
        <table class="article-table">
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
        </table>
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
    return "<div class=\"loading\">Đang tải địa điểm thi...</div>";
  }

  const keyword = state.search.trim().toLowerCase();
  const locations = state.locations.filter((item) => {
    if (!keyword) return true;
    return JSON.stringify(item).toLowerCase().includes(keyword);
  });

  return `
    <section class="page-head">
      <div>
        <p class="page-kicker">Trung tâm sát hạch</p>
        <h1 class="page-title">Địa điểm thi</h1>
        <p class="page-copy">Tra nhanh trung tâm thi theo tỉnh, tên trung tâm hoặc địa chỉ romaji.</p>
      </div>
    </section>
    <section class="toolbar">
      <input class="search" data-location-search value="${escapeAttribute(state.search)}" placeholder="Tìm tỉnh, trung tâm, địa chỉ..." />
    </section>
    <section class="locations-list">
      ${locations.map(renderLocation).join("") || "<div class=\"empty-state\">Không có kết quả phù hợp.</div>"}
    </section>
  `;
}

function renderLocation(item) {
  return `
    <article class="location-row">
      <h3>${escapeHtml(item.center.ja)} · ${escapeHtml(item.center.romaji)}</h3>
      <p>${escapeHtml(item.prefecture.ja)} · ${escapeHtml(item.prefecture.romaji)}</p>
      <p>${escapeHtml(item.address.ja)} · ${escapeHtml(item.address.romaji)}</p>
      ${item.google_maps_url ? `<p><a href="${escapeAttribute(item.google_maps_url)}" target="_blank" rel="noreferrer">Mở Google Maps</a></p>` : ""}
    </article>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      state.currentArticle = null;
      render();
    });
  });

  document.querySelectorAll("[data-exam-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.examsByType = button.dataset.examFilter;
      render();
    });
  });

  document.querySelectorAll("[data-start-exam]").forEach((button) => {
    button.addEventListener("click", () => startExam(button.dataset.startExam).catch(showError));
  });

  document.querySelectorAll("[data-go-question]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentQuestionIndex = Number(button.dataset.goQuestion);
      render();
    });
  });

  document.querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => answerCurrent(button.dataset.answer === "true"));
  });

  document.querySelectorAll("[data-choice-answer]").forEach((button) => {
    button.addEventListener("click", () => answerChoice(button.dataset.choiceAnswer));
  });

  document.querySelector("[data-prev-question]")?.addEventListener("click", () => {
    state.currentQuestionIndex = Math.max(0, state.currentQuestionIndex - 1);
    render();
  });

  document.querySelector("[data-next-question]")?.addEventListener("click", () => {
    state.currentQuestionIndex = Math.min(state.currentExam.questions.length - 1, state.currentQuestionIndex + 1);
    render();
  });

  document.querySelector("[data-submit-exam]")?.addEventListener("click", scoreExam);
  document.querySelector("[data-back-exams]")?.addEventListener("click", () => {
    state.tab = "exams";
    render();
  });

  document.querySelectorAll("[data-open-article]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentArticle = button.dataset.openArticle;
      render();
    });
  });

  document.querySelector("[data-close-article]")?.addEventListener("click", () => {
    state.currentArticle = null;
    render();
  });

  document.querySelector("[data-location-search]")?.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
    document.querySelector("[data-location-search]")?.focus();
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
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
