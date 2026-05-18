// "Is this an editable text field?" — handles the messy reality of the web:
// <input>, <textarea>, contenteditable, role=textbox, plus "rich" editors
// like Gmail's compose (which hides a contenteditable inside iframes/divs).

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "email",
  "tel",
  "password", // we never enable popover here regardless
]);

export const isEditable = (el: HTMLElement): boolean => {
  if (el.isContentEditable) {
    // Don't activate inside our own UI.
    if (el.closest("[data-inkwell-root]")) return false;
    return true;
  }
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    if (el.type === "password") return false; // never assist on password fields
    if (!TEXT_INPUT_TYPES.has(el.type)) return false;
    return !el.disabled && !el.readOnly;
  }
  return false;
};

export const readText = (el: HTMLElement): string => {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  if (el.isContentEditable) {
    return el.innerText;
  }
  return "";
};

export const writeText = (el: HTMLElement, text: string): void => {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    // Use setRangeText so frameworks (React) see a real input event.
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.setRangeText(text, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (el.isContentEditable) {
    el.focus();
    // For contenteditable, use execCommand — deprecated but still the most
    // compatible way to insert text and trigger framework listeners. If
    // execCommand is unavailable we fall back to a Selection API insert.
    try {
      const ok = document.execCommand("insertText", false, text);
      if (ok) return;
    } catch {
      // ignore
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
    } else {
      el.appendChild(document.createTextNode(text));
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
};
