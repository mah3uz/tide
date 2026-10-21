/**
 * Moves focus into a sheet as it opens (onto `target`, a selector inside it,
 * or the sheet itself) and back to whatever had it once the sheet closes.
 */
export function sheetFocus(node: HTMLElement, target?: string) {
  const opener = document.activeElement;
  const into = (target && node.querySelector<HTMLElement>(target)) || node;
  into.focus({ preventScroll: true });
  return {
    destroy() {
      // After the flush that closed the sheet, when the stage behind it is no
      // longer inert and can take focus again.
      queueMicrotask(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost && opener instanceof HTMLElement && opener.isConnected) {
          opener.focus({ preventScroll: true });
        }
      });
    }
  };
}
