import { useState } from "react";
import type { BlobProfile } from "../inspector/blobProfiles.ts";
import { useBlobSelection } from "../inspector/BlobSelection.tsx";
import { capitalise, type BlobActivity } from "../inspector/inspectorModel.ts";
import { moveListFocus } from "../inspector/listKeys.ts";
import { MOOD_COLOR, MOOD_MEANING, type Mood } from "../scene/blobMood.ts";
import { ageGroup } from "../scene/blobSize.ts";
import { SearchIcon } from "./icons.tsx";
import { filterPeople, moodMix } from "./people.ts";

// What a resident is visibly doing, in a word, for the list; walking and idling go unsaid.
const DOING: Partial<Record<BlobActivity["state"], string>> = {
  talking: "Talking",
  listening: "Listening",
  posting: "Posting",
  scrolling: "Scrolling",
};

function blobs(count: number) {
  return `${count} ${count === 1 ? "blob" : "blobs"}`;
}

/**
 * Everyone in town. The bar on top is the town's live mood mix, one segment per mood sized by
 * how many wear it; pressing a segment shows only them. Search matches names, shapes, age groups
 * and traits. Choosing someone selects them, and their card opens; the list stays, so you can
 * keep browsing.
 */
export default function PeopleView() {
  const { catalog, activities, selectedId, focusBlob } = useBlobSelection();
  const [query, setQuery] = useState("");
  const [mood, setMood] = useState<Mood | null>(null);
  const moodOf = (id: number): Mood => activities[id]?.mood ?? catalog.get(id)?.mood ?? "flat";
  const people = catalog.order
    .map((id) => catalog.get(id))
    .filter((p): p is BlobProfile => p !== undefined);
  const mix = moodMix(catalog.order, moodOf);
  const shown = filterPeople(people, query, mood, moodOf);
  const moodCount = mix.find((m) => m.mood === mood)?.count ?? 0;

  return (
    <>
      <div className="panel-tools">
        <div className="mood-mix" role="group" aria-label="Show only one mood">
          {mix.map(({ mood: m, count }) => (
            <button
              key={m}
              type="button"
              className="mood-segment"
              style={{ flexGrow: count, background: MOOD_COLOR[m] }}
              aria-pressed={mood === m}
              aria-label={`${blobs(count)} ${MOOD_MEANING[m]}`}
              title={`${blobs(count)} · ${MOOD_MEANING[m]}`}
              onClick={() => setMood(mood === m ? null : m)}
            />
          ))}
        </div>
        <p className="mood-legend" aria-live="polite">
          {mood ? (
            <>
              <span className="mood-dot" style={{ background: MOOD_COLOR[mood] }} aria-hidden />
              {capitalise(blobs(moodCount))} · {MOOD_MEANING[mood]}
              <button type="button" className="text-button" onClick={() => setMood(null)}>
                Show everyone
              </button>
            </>
          ) : (
            "The town's mood right now. Press a colour to filter."
          )}
        </p>
        <label className="search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            placeholder={`Search ${people.length} residents`}
            aria-label="Search residents by name, shape, age or trait"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="panel-scroll">
        {shown.length === 0 ? (
          <div className="panel-empty">
            <p className="panel-empty-title">
              {people.length === 0 ? "Waiting for the town" : "Nobody matches"}
            </p>
            {people.length > 0 && (
              <p>Try a name, a shape like “star”, or a trait like “skeptic”.</p>
            )}
          </div>
        ) : (
          <ul className="people" onKeyDown={(event) => moveListFocus(event, ".person")}>
            {shown.map((p) => {
              const activity = activities[p.id];
              const doing = activity ? DOING[activity.state] : undefined;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="person"
                    aria-pressed={p.id === selectedId}
                    onClick={() => focusBlob(p.id)}
                  >
                    <span
                      className="person-swatch"
                      style={{ background: MOOD_COLOR[moodOf(p.id)] }}
                      aria-hidden
                    />
                    <span className="person-text">
                      <span className="person-name">{p.name}</span>
                      <span className="person-detail">
                        {capitalise(p.shape)} · {capitalise(ageGroup(p.age))}
                      </span>
                    </span>
                    {doing && <span className="person-doing">{doing}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
