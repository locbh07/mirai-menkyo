export function isBlockedShortcut(event) {
  if (event.isComposing) return false;
  const key = String(event.key || "").toLowerCase();
  if (key === "f12" || event.code === "F12") return true;
  const command = event.ctrlKey || event.metaKey;
  const inspectKeys = ["i", "j", "c"];
  const inspect = event.ctrlKey && event.shiftKey && !event.altKey && inspectKeys.includes(key)
    || event.metaKey && event.altKey && inspectKeys.includes(key)
    || event.metaKey && event.shiftKey && key === "c";
  const source = command && key === "u" && (!event.altKey || event.metaKey);
  return Boolean(inspect || source);
}

export function installShortcutDeterrent(target = document) {
  // This can cancel page key events; it cannot close or control browser DevTools.
  const handleKey = (event) => {
    if (event.cancelable && isBlockedShortcut(event)) event.preventDefault();
  };
  target.addEventListener("keydown", handleKey, { capture: true });
  return () => target.removeEventListener("keydown", handleKey, { capture: true });
}
