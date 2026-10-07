import { translate } from "./i18n.js";
import { icon } from "./icons.js";

const BASELINE_KEY = "mirai-menkyo-desktop-metrics";

function hasDesktopPlatform(metrics) {
  // iPadOS may legitimately report MacIntel when requesting desktop sites.
  if (/Mac/i.test(metrics.platform) && metrics.touchPoints > 0 && /iPad|Macintosh/i.test(metrics.userAgent)) return false;
  return /^(Win|Mac|Linux (x86_64|i[3-6]86))/i.test(metrics.platform);
}

export function hasDeviceEmulationSignal(metrics, desktopBaseline) {
  if (metrics.fullscreen) return false;
  if (hasDesktopPlatform(metrics) && metrics.mobileAgent) return true;
  if (!desktopBaseline) return false;
  const screenChanged = Math.abs(metrics.screenWidth - desktopBaseline.screenWidth) > 160
    || Math.abs(metrics.screenHeight - desktopBaseline.screenHeight) > 160;
  const becameMobile = metrics.mobileAgent && !desktopBaseline.mobileAgent
    || metrics.touchPoints > 0 && desktopBaseline.touchPoints === 0;
  return screenChanged && becameMobile;
}

export function hasDockedToolsSignal(metrics, initialRatio = metrics.ratio) {
  const { outerWidth, outerHeight, innerWidth, innerHeight, ratio, mobile, finePointer, fullscreen } = metrics;
  if (mobile || !finePointer || fullscreen || outerWidth < 960 || outerHeight < 600) return false;
  if (![outerWidth, outerHeight, innerWidth, innerHeight, ratio].every((value) => Number.isFinite(value) && value > 0)) return false;
  if (Math.abs(ratio - initialRatio) > 0.04) return false;
  const widthGap = outerWidth - innerWidth;
  const heightGap = outerHeight - innerHeight;
  // Two large gaps usually indicate zoom/scaling, rather than one docked panel.
  return widthGap > 320 && heightGap >= 0 && heightGap < 200
    || heightGap > 300 && widthGap >= 0 && widthGap < 120;
}

function browserMetrics() {
  const mobileAgent = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return {
    outerWidth: window.outerWidth, outerHeight: window.outerHeight,
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    ratio: window.devicePixelRatio,
    mobile: navigator.maxTouchPoints > 0 || mobileAgent,
    mobileAgent, platform: navigator.platform, userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints,
    screenWidth: window.screen.width, screenHeight: window.screen.height,
    finePointer: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    fullscreen: Boolean(document.fullscreenElement) || window.matchMedia("(display-mode: fullscreen)").matches,
  };
}

export function createDevtoolsGuard({ getLocale = () => document.documentElement.lang, onBlockChange = () => {} } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "devtools-notice";
  dialog.setAttribute("aria-labelledby", "devtools-notice-title");
  dialog.setAttribute("aria-describedby", "devtools-notice-message");
  const symbol = document.createElement("div");
  symbol.className = "devtools-notice-symbol";
  symbol.innerHTML = icon("shield-alert");
  const title = document.createElement("h2");
  title.id = "devtools-notice-title";
  const message = document.createElement("p");
  message.id = "devtools-notice-message";
  const status = document.createElement("p");
  status.className = "devtools-notice-status";
  status.setAttribute("role", "status");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "button devtools-notice-retry";
  retry.innerHTML = `${icon("rotate-ccw")}<span></span>`;
  dialog.append(symbol, title, message, status, retry);
  document.body.append(dialog);

  let blocked = false, suspectSamples = 0, clearSamples = 0, failedRetry = false;
  let previousFocus, settled = false;
  const initialRatio = window.devicePixelRatio;
  let desktopBaseline;
  try {
    const saved = JSON.parse(sessionStorage.getItem(BASELINE_KEY));
    if (saved && [saved.screenWidth, saved.screenHeight, saved.touchPoints].every(Number.isFinite)
      && saved.screenWidth > 0 && saved.screenHeight > 0 && saved.touchPoints >= 0 && saved.mobileAgent === false) desktopBaseline = saved;
  } catch { /* Storage may be unavailable in private or restricted contexts. */ }
  const waiters = new Set();
  let settleInitial;
  const initialCheck = new Promise((resolve) => { settleInitial = resolve; });

  function settle() {
    if (!settled) { settled = true; settleInitial(); }
  }

  function updateText() {
    const locale = getLocale() || "vi";
    dialog.lang = locale;
    title.textContent = translate(locale, "devtoolsTitle");
    message.textContent = translate(locale, "devtoolsMessage");
    retry.querySelector("span").textContent = translate(locale, "retry");
    status.textContent = failedRetry ? translate(locale, "devtoolsRetryFailed") : "";
    status.hidden = !failedRetry;
  }

  function setBlocked(value) {
    if (blocked === value) return;
    blocked = value;
    if (blocked) {
      failedRetry = false;
      previousFocus = document.activeElement;
      updateText();
      dialog.showModal();
      retry.focus({ preventScroll: true });
      onBlockChange(true);
    } else {
      dialog.close();
      onBlockChange(false);
      const target = previousFocus?.isConnected ? previousFocus : document.querySelector(".question-title") || document.querySelector(".language-trigger");
      target?.focus({ preventScroll: true });
      for (const resolve of waiters) resolve();
      waiters.clear();
    }
  }

  function probe() {
    if (document.visibilityState !== "visible") return;
    const metrics = browserMetrics();
    const suspect = isSuspect(metrics);
    if (!desktopBaseline && !suspect && hasDesktopPlatform(metrics) && !metrics.mobileAgent && metrics.finePointer) {
      desktopBaseline = { screenWidth: metrics.screenWidth, screenHeight: metrics.screenHeight, touchPoints: metrics.touchPoints, mobileAgent: false };
      try { sessionStorage.setItem(BASELINE_KEY, JSON.stringify(desktopBaseline)); } catch { /* Keep the in-memory baseline. */ }
    }
    if (suspect) {
      clearSamples = 0;
      suspectSamples += 1;
      if (suspectSamples >= 3) { setBlocked(true); settle(); }
    } else {
      suspectSamples = 0;
      clearSamples += 1;
      if (clearSamples >= 2) setBlocked(false);
      settle();
    }
  }

  function isSuspect(metrics) {
    return hasDeviceEmulationSignal(metrics, desktopBaseline) || hasDockedToolsSignal(metrics, initialRatio);
  }

  retry.addEventListener("click", () => {
    if (isSuspect(browserMetrics())) {
      failedRetry = true;
      updateText();
    } else {
      suspectSamples = 0;
      setBlocked(false);
      settle();
    }
  });
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  document.addEventListener("visibilitychange", probe);
  document.addEventListener("fullscreenchange", probe);
  // Geometry is only a heuristic: detached tools and browser sidebars cannot be distinguished reliably.
  const interval = window.setInterval(probe, 500);
  probe();

  return {
    get blocked() { return blocked; },
    async waitUntilAllowed() {
      await initialCheck;
      if (blocked) await new Promise((resolve) => waiters.add(resolve));
    },
    destroy() {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", probe);
      document.removeEventListener("fullscreenchange", probe);
      setBlocked(false);
      settle();
      dialog.remove();
    },
  };
}
