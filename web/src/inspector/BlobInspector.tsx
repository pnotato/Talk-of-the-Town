import { type MouseEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import BlobCard from "./BlobCard.tsx";
import BlobPicker from "./BlobPicker.tsx";
import { useBlobSelection } from "./BlobSelection.tsx";
import { type FocusInset, focusInset, sameInset } from "./focusInset.ts";
import { stepSelection } from "./inspectorModel.ts";
import "./inspector.css";

function BrowseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <rect x="1.4" y="1.4" width="5.4" height="5.4" rx="1.7" fill="currentColor" />
      <rect x="9.2" y="1.4" width="5.4" height="5.4" rx="1.7" fill="currentColor" opacity="0.55" />
      <rect x="1.4" y="9.2" width="5.4" height="5.4" rx="1.7" fill="currentColor" opacity="0.55" />
      <rect x="9.2" y="9.2" width="5.4" height="5.4" rx="1.7" fill="currentColor" />
    </svg>
  );
}

function StepIcon({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d={direction === "previous" ? "m9.8 3.2-4.6 4.8 4.6 4.8" : "m6.2 3.2 4.6 4.8-4.6 4.8"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The bottom-left inspector: a bar that is always there (browse, step, hint) with either the
 * selected blob's card or, while browsing, the list of blobs in the card's place (picking from it
 * puts it away). The scene selects
 * by click; everything here works from the keyboard too. Escape closes the list first, then the
 * card.
 *
 * The bar comes first in the DOM (and is drawn at the bottom) so Tab goes from Browse straight into
 * whatever it opened.
 *
 * `onFocusInsetChange` reports how much of the view the inspector covers (the top edge of the
 * stage, the card, list or bar at the bottom), measured from what is actually drawn, whenever it
 * changes. The scene uses it to keep a focused blob clear of the inspector.
 */
export default function BlobInspector({
  onFocusInsetChange,
}: {
  onFocusInsetChange?: (inset: FocusInset) => void;
}) {
  const { selectedId, selectBlob, focusBlob, catalog } = useBlobSelection();
  const profile = selectedId === null ? undefined : catalog.get(selectedId);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Whether the list was opened from the keyboard, and so should take focus when it appears.
  const [pickerFromKeyboard, setPickerFromKeyboard] = useState(false);
  const dock = useRef<HTMLElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const pickerId = useId();
  // Set by a keyboard pick: the card that appears next takes focus, once.
  const cardTakesFocus = useRef(false);
  const reportInset = useRef(onFocusInsetChange);
  const lastInset = useRef<FocusInset | null>(null);
  const panelKind = pickerOpen ? "picker" : profile ? "card" : "bar";

  function takeCardFocus() {
    const take = cardTakesFocus.current;
    cardTakesFocus.current = false;
    return take;
  }

  useLayoutEffect(() => {
    reportInset.current = onFocusInsetChange;
  });

  // Measures the card or list (or the bar when neither shows) and reports the inset when it changes.
  // It watches the dock, its parent and the panel for resizes, and the window as well: a resized
  // window moves the parent's bottom even when no panel changed size.
  useLayoutEffect(() => {
    const root = dock.current;
    if (!root) return;
    const parent = root.offsetParent ?? root.parentElement;
    const bar = root.querySelector<HTMLElement>(".inspector-bar");
    const panel = root.querySelector<HTMLElement>(".inspector-card, .inspector-picker");
    if (!parent || !bar) return;

    function measure() {
      if (!root || !parent || !bar) return;
      const gap = parseFloat(getComputedStyle(root).rowGap) || 0;
      const inset = focusInset(
        parent.getBoundingClientRect().bottom,
        bar.getBoundingClientRect().top,
        panel ? panel.offsetHeight : null,
        gap,
        parent.getBoundingClientRect().height,
      );
      if (lastInset.current && sameInset(lastInset.current, inset)) return;
      lastInset.current = inset;
      reportInset.current?.(inset);
    }

    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [root, parent, bar, panel]) if (element) observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [panelKind]);

  // Hands focus to the always-present browse button, but only when it was inside the inspector
  // (so a panel that closes under the keyboard doesn't strand focus, and a mouse click never jumps).
  function keepFocus() {
    if (dock.current?.contains(document.activeElement)) browse.current?.focus();
  }

  function closeCard() {
    keepFocus();
    selectBlob(null);
  }

  // Stepping, like picking a blob, takes the camera along with the selection.
  function step(direction: 1 | -1) {
    const id = stepSelection(catalog.order, selectedId, direction);
    if (id !== null) focusBlob(id);
  }

  // Picking from the list puts the list away at once (so it never hides where the camera is going)
  // and takes the camera to the blob. A keyboard pick moves focus to the new card's name; a pointer
  // pick doesn't move focus.
  function pick(id: number, viaKeyboard: boolean) {
    cardTakesFocus.current = viaKeyboard;
    setPickerOpen(false);
    focusBlob(id);
  }

  function closePicker() {
    keepFocus();
    setPickerOpen(false);
  }

  function toggleBrowse(event: MouseEvent<HTMLButtonElement>) {
    // A click from the keyboard (Enter or Space) has no pointer position: its `detail` is 0.
    setPickerFromKeyboard(event.detail === 0);
    setPickerOpen((open) => !open);
  }

  // Escape closes the list first, then the card. Handled on window so it works wherever focus is,
  // including over the canvas.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (pickerOpen) {
        closePicker();
      } else if (selectedId !== null) {
        closeCard();
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // A press anywhere outside the inspector (the scene, say) puts the list away.
  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !dock.current?.contains(event.target)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  return (
    <aside ref={dock} className="inspector-dock" aria-label="Blob inspector">
      <div className="inspector-surface inspector-bar hud-glass">
        <button
          ref={browse}
          type="button"
          className="inspector-button inspector-primary"
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? pickerId : undefined}
          onClick={toggleBrowse}
        >
          <BrowseIcon />
          Browse blobs
        </button>
        <button
          type="button"
          className="inspector-button inspector-step"
          aria-label="Previous blob"
          onClick={() => step(-1)}
        >
          <StepIcon direction="previous" />
        </button>
        <button
          type="button"
          className="inspector-button inspector-step"
          aria-label="Next blob"
          onClick={() => step(1)}
        >
          <StepIcon direction="next" />
        </button>
        {!profile && !pickerOpen && <span className="bar-hint">Click a blob to inspect it</span>}
      </div>

      {pickerOpen ? (
        <BlobPicker
          id={pickerId}
          takeFocus={pickerFromKeyboard}
          onPick={pick}
          onClose={closePicker}
        />
      ) : (
        profile && <BlobCard profile={profile} onClose={closeCard} takeFocus={takeCardFocus} />
      )}

      <p role="status" className="inspector-sr">
        {profile ? `Selected ${profile.name}, ${profile.shape}, age ${profile.age}` : ""}
      </p>
    </aside>
  );
}
