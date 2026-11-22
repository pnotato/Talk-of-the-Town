import { type KeyboardEvent, useEffect, useRef } from "react";
import { MOOD_COLOR } from "../scene/blobMood.ts";
import { ageGroup } from "../scene/blobSize.ts";
import { GROUP_TITLES, PROFILES, type ProfileGroup } from "./blobProfiles.ts";
import { useBlobSelection } from "./BlobSelection.tsx";
import { capitalise } from "./inspectorModel.ts";

const GROUPS: ProfileGroup[] = ["shapes", "moods", "scenes"];

// Up and down arrows (and Home and End) move between the blobs, so a long list is quick to walk.
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll(".picker-item"));
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

/**
 * Every blob in the sandbox as a button, so the scene isn't the only way to pick one. It stands in
 * the selected blob's card's place while browsing, and fills the space the dock has (the list
 * scrolls; its header stays).
 *
 * Choosing a blob hands it to `onPick`, which puts the list away and takes the camera there, so
 * the list never hides the blob the camera is heading for. Done, Escape or the Browse button also
 * put it away. Use Previous and Next to step through blobs without reopening the list.
 *
 * Opened from the keyboard, it takes focus on the chosen blob (or the first one). Opened by mouse
 * it only scrolls the chosen blob into view.
 */
export default function BlobPicker({
  id,
  takeFocus,
  onPick,
  onClose,
}: {
  id: string;
  takeFocus: boolean;
  /** `viaKeyboard` is true for Enter or Space, which has no pointer position. */
  onPick: (id: number, viaKeyboard: boolean) => void;
  onClose: () => void;
}) {
  const { selectedId, activities } = useBlobSelection();
  const list = useRef<HTMLDivElement>(null);

  // On open only: later selections shouldn't pull focus or the scroll position about.
  useEffect(() => {
    const items = list.current?.querySelectorAll<HTMLElement>(".picker-item");
    if (!items || items.length === 0) return;
    const chosen = Array.from(items).find((item) => item.getAttribute("aria-pressed") === "true");
    const target = chosen ?? items[0];
    if (takeFocus) target.focus();
    else chosen?.scrollIntoView({ block: "nearest" });
  }, [takeFocus]);

  return (
    <section id={id} className="inspector-surface inspector-picker" aria-label="Browse blobs">
      <header className="picker-head">
        <div className="picker-heading">
          <h2>Blob directory</h2>
          <p className="picker-subtitle">Every resident in the sandbox</p>
        </div>
        <button type="button" className="inspector-button picker-done" onClick={onClose}>
          Done
        </button>
      </header>
      <div ref={list} className="picker-scroll" onKeyDown={moveFocus}>
        {GROUPS.map((group) => (
          <section key={group} aria-labelledby={`${id}-${group}`}>
            <h3 id={`${id}-${group}`} className="picker-group-title">
              {GROUP_TITLES[group]}
            </h3>
            <ul>
              {PROFILES.filter((p) => p.group === group).map((p) => {
                const mood = activities[p.id]?.mood ?? p.mood;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="picker-item"
                      aria-pressed={p.id === selectedId}
                      onClick={(event) => onPick(p.id, event.detail === 0)}
                    >
                      <span
                        className="picker-swatch"
                        style={{ background: MOOD_COLOR[mood] }}
                        aria-hidden
                      />
                      <span className="picker-text">
                        <span className="picker-name">{p.name}</span>
                        <span className="picker-detail">
                          {capitalise(p.shape)} · {capitalise(ageGroup(p.age))}
                          {group === "scenes" ? ` · ${p.place}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
