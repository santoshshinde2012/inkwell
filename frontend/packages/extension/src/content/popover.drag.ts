// Header drag handle for the in-page popover.
//
// Anywhere on the header (other than its child buttons) starts a drag.
// Pointer events cover mouse, pen, and touch with one listener pair.
// ``setPointerCapture`` means the move/up events keep firing on the
// head even if the cursor slips outside it mid-drag.
//
// Extracted from popover.ts to keep that file focused on initial DOM
// construction. The helper just reads/writes ``root.style.{left,top}``
// — nothing else in the popover cares whether dragging is happening.

/**
 * Attach drag handlers to `head` that move `root` by setting CSS
 * ``left`` / ``top`` in pixels. The popover is clamped to the
 * viewport with an 8px margin so a user can never lose it off-screen.
 *
 * Returns a `dispose()` callback that removes all four listeners —
 * useful if you ever want to detach drag without unmounting the
 * popover.
 */
export function attachHeaderDrag(head: HTMLElement, root: HTMLElement): () => void {
  let dragPointerId: number | null = null;
  let dragOriginX = 0;
  let dragOriginY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;

  const isInteractiveTarget = (el: EventTarget | null): boolean => {
    if (!(el instanceof Element)) return false;
    // Buttons inside the header (close, expand) — let those fire instead.
    return el.closest("button") != null;
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    // Lock the popover's current position into absolute px so the move
    // handler has stable origins to work against. parseFloat tolerates
    // both "12px" and "" (treated as NaN, falls back to bounding rect).
    const rect = root.getBoundingClientRect();
    dragStartLeft = Number.isFinite(parseFloat(root.style.left))
      ? parseFloat(root.style.left)
      : rect.left;
    dragStartTop = Number.isFinite(parseFloat(root.style.top))
      ? parseFloat(root.style.top)
      : rect.top;
    dragOriginX = e.clientX;
    dragOriginY = e.clientY;
    dragPointerId = e.pointerId;
    head.classList.add("dragging");
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (dragPointerId !== e.pointerId) return;
    const margin = 8;
    const w = root.offsetWidth || 420;
    const h = root.offsetHeight || 360;
    let nextLeft = dragStartLeft + (e.clientX - dragOriginX);
    let nextTop = dragStartTop + (e.clientY - dragOriginY);
    // Clamp so the popover always overlaps the viewport — never lets the
    // user lose it off-screen.
    nextLeft = Math.min(window.innerWidth - w - margin, Math.max(margin, nextLeft));
    nextTop = Math.min(window.innerHeight - h - margin, Math.max(margin, nextTop));
    root.style.left = `${nextLeft}px`;
    root.style.top = `${nextTop}px`;
  };

  const onUp = (e: PointerEvent): void => {
    if (dragPointerId !== e.pointerId) return;
    dragPointerId = null;
    head.classList.remove("dragging");
    if (head.hasPointerCapture(e.pointerId)) {
      head.releasePointerCapture(e.pointerId);
    }
  };

  head.addEventListener("pointerdown", onDown);
  head.addEventListener("pointermove", onMove);
  head.addEventListener("pointerup", onUp);
  head.addEventListener("pointercancel", onUp);

  return () => {
    head.removeEventListener("pointerdown", onDown);
    head.removeEventListener("pointermove", onMove);
    head.removeEventListener("pointerup", onUp);
    head.removeEventListener("pointercancel", onUp);
    // Release any in-progress drag capture so the cancelled pointer
    // doesn't keep firing after the popover's DOM is gone.
    if (dragPointerId !== null && head.hasPointerCapture(dragPointerId)) {
      head.releasePointerCapture(dragPointerId);
    }
  };
}
