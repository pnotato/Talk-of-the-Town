import type { KeyboardEvent } from "react";

/**
 * Up and down arrows (and Home and End) move focus between the items matching `selector` inside
 * the element handling the event, so a long list is quick to walk from the keyboard.
 */
export function moveListFocus(event: KeyboardEvent<HTMLElement>, selector: string) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll(selector));
  if (items.length === 0) return;
  const at = items.findIndex((item) => item === document.activeElement);
  const last = items.length - 1;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowDown"
          ? Math.min(last, at + 1)
          : Math.max(0, at - 1);
  event.preventDefault();
  if (items[next] instanceof HTMLElement) items[next].focus();
}
