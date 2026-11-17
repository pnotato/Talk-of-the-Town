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
 * scrolls; its header stays). Choosing a blob leaves it open for stepping through; Done, Escape or
 * the Browse button put it away and bring the card back.
 *
 * Opened from the keyboard, it takes focus on the chosen blob (or the first one). Opened by mouse
 * it only scrolls the chosen blob into view.
 */
export default function BlobPicker({
  id,
  takeFocus,
  onClose,
}: {
  id: string;
  takeFocus: boolean;
  onClose: () => void;
}) {
  const { selectedId, selectBlob, activities } = useBlobSelection();
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
        <h2 className="inspector-eyebrow">Browse blobs</h2>
        <button type="button" className="inspector-button picker-done" onClick={onClose}>
          Done
        </button>
      </header>
      <div ref={list} className="picker-scroll" onKeyDown={moveFocus}>
        {GROUPS.map((group) => (
          <section key={group} aria-labelledby={`${id}-${group}`}>
            <h3 id={`${id}-${group}`} className="inspector-eyebrow">
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
                      onClick={() => selectBlob(p.id)}
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
