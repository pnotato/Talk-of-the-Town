import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef } from "react";
import { MOOD_COLOR, MOOD_MEANING } from "../scene/blobMood.ts";
import { ageGroup } from "../scene/blobSize.ts";
import BlobPortrait from "../scene/BlobPortrait.tsx";
import type { BlobProfile } from "./blobProfiles.ts";
import { useBlobSelection } from "./BlobSelection.tsx";
import { capitalise, describeAction, interestLabel, perceptionLabel } from "./inspectorModel.ts";
import Meter from "./Meter.tsx";
import { personalityTags, specialTags } from "./traitGroups.ts";

// Portraits are live WebGL canvases, so only so many relatives get one: the card shows at most
// this many thumbnails of family, plus the main portrait and the conversation partner's.
const MAX_FAMILY_THUMBNAILS = 2;

/**
 * Ref callback for a button that can vanish under the keyboard: a relative once their own card is
 * showing, or a partner who stops talking to this blob. If the button is removed while the
 * keyboard has focus on it, focus goes to `fallback` instead of dropping to the page. A mouse click
 * never triggers this, so pointer navigation doesn't move focus.
 */
function useKeyboardFocusRescue(fallback: RefObject<HTMLElement | null>) {
  return useCallback(
    (button: HTMLButtonElement | null) => {
      if (!button) return;
      return () => {
        if (document.activeElement === button && button.matches(":focus-visible")) {
          fallback.current?.focus();
        }
      };
    },
    [fallback],
  );
}

/**
 * A blob named in the card (a relative or the conversation partner): its portrait, if `thumbnail`,
 * and its name, with a native button laid over the whole chip that goes to that blob.
 *
 * The portrait is a canvas, which renders a div, and a button may only hold phrasing content. So
 * the visuals are the button's sibling, hidden from assistive tech, and the button carries the name.
 * The visible name is part of its accessible name "Go to Name".
 */
function BlobChip({
  id,
  thumbnail,
  fallback,
}: {
  id: number;
  thumbnail: boolean;
  fallback: RefObject<HTMLElement | null>;
}) {
  const { focusBlob, activities, catalog } = useBlobSelection();
  const rescue = useKeyboardFocusRescue(fallback);
  const profile = catalog.get(id);
  if (!profile) return <span>Blob {id}</span>;
  const mood = activities[id]?.mood ?? profile.mood;
  return (
    <div className="blob-chip">
      <div className="chip-visual" aria-hidden>
        {thumbnail && (
          <div className="chip-portrait" style={{ borderColor: MOOD_COLOR[mood] }}>
            <BlobPortrait shape={profile.shape} age={profile.age} mood={mood} />
          </div>
        )}
        <span className="chip-name">{profile.name}</span>
      </div>
      <button
        ref={rescue}
        type="button"
        className="chip-hit"
        aria-label={`Go to ${profile.name}`}
        onClick={() => focusBlob(id)}
      />
    </div>
  );
}

function Family({
  profile,
  fallback,
}: {
  profile: BlobProfile;
  fallback: RefObject<HTMLElement | null>;
}) {
  const groups = [
    { label: "Child of", ids: profile.parentIds },
    { label: "Parent of", ids: profile.childIds },
  ].filter((group) => group.ids.length > 0);
  if (groups.length === 0) return null;

  let thumbnails = MAX_FAMILY_THUMBNAILS;
  return groups.map(({ label, ids }) => (
    <div key={label} className="family-group">
      <span className="family-label">{label}</span>
      {ids.map((id) => (
        <BlobChip key={id} id={id} thumbnail={thumbnails-- > 0} fallback={fallback} />
      ))}
    </div>
  ));
}

function Tags({
  kind,
  label,
  children,
}: {
  kind: "special" | "personality";
  label: string;
  children: ReactNode[];
}) {
  if (children.length === 0) return null;
  return (
    <ul className={`tags tag-row-${kind}`} aria-label={label} role="list">
      {children}
    </ul>
  );
}

function CardIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden focusable="false">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const PREVIOUS_PATH = "M12 4.8 6.8 10l5.2 5.2";
const NEXT_PATH = "m8 4.8 5.2 5.2L8 15.2";
const CLOSE_PATH = "m5.6 5.6 8.8 8.8M14.4 5.6l-8.8 8.8";

/**
 * The selected blob's profile, as one compact card. Top to bottom: the portrait beside the name,
 * age, shape and what the blob's face says; family; the two meters; traits; and the current action
 * with whoever the blob is talking with. The portrait and every named blob are buttons that take
 * the camera to that blob. `onStep`, when given, adds previous and next buttons beside close.
 *
 * The profile comes from the page's catalog; the face, action, partner and live scores come from
 * the scene's activity report, falling back to the profile's resting values.
 */
export default function BlobCard({
  profile,
  onClose,
  onStep,
  takeFocus,
}: {
  profile: BlobProfile;
  onClose: () => void;
  /** Step to the previous (-1) or next (1) blob in the catalog. */
  onStep?: (direction: 1 | -1) => void;
  /** Asked once when the card appears: true puts keyboard focus on the name (a keyboard pick). */
  takeFocus?: () => boolean;
}) {
  const { activities, focusBlob, catalog } = useBlobSelection();
  const heading = useRef<HTMLHeadingElement>(null);
  const descriptionId = useId();
  useEffect(() => {
    if (takeFocus?.()) heading.current?.focus();
    // On appearing only: later renders mustn't pull focus.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const activity = activities[profile.id];
  // The face comes from the scene's activity once it reports; until then, the profile's resting
  // face. The scores never depend on it.
  const mood = activity?.mood ?? profile.mood;
  const perception = activity?.perception ?? profile.perception;
  const interest = activity?.interest ?? profile.interest;
  const action = describeAction(activity);
  const special = specialTags(profile);
  const personality = personalityTags(profile);

  return (
    <section
      className="inspector-card"
      aria-label={`Selected blob: ${profile.name}`}
      aria-describedby={descriptionId}
    >
      <p id={descriptionId} className="inspector-sr">
        {catalog.description}
      </p>

      <header className="card-top">
        <div className="card-portrait">
          {/* The button lies over the portrait: a canvas can't sit inside a button. */}
          <button
            type="button"
            className="portrait-hit"
            aria-label={`Go to ${profile.name}`}
            aria-description={`${capitalise(mood)} expression. ${MOOD_MEANING[mood]}`}
            onClick={() => focusBlob(profile.id)}
          />
          <div className="portrait" style={{ borderColor: MOOD_COLOR[mood] }} aria-hidden>
            <BlobPortrait shape={profile.shape} age={profile.age} mood={mood} />
          </div>
        </div>

        <div className="card-identity">
          <h2 ref={heading} tabIndex={-1}>
            {profile.name}
          </h2>
          <p className="card-meta">
            Age {profile.age} · {capitalise(ageGroup(profile.age))} · {capitalise(profile.shape)}
          </p>
          <p className="card-mood">
            <span className="card-mood-dot" style={{ background: MOOD_COLOR[mood] }} aria-hidden />
            {capitalise(MOOD_MEANING[mood])}
          </p>
        </div>

        <div className="card-actions">
          {onStep && (
            <>
              <button
                type="button"
                className="card-icon-button"
                aria-label="Previous blob"
                onClick={() => onStep(-1)}
              >
                <CardIcon path={PREVIOUS_PATH} />
              </button>
              <button
                type="button"
                className="card-icon-button"
                aria-label="Next blob"
                onClick={() => onStep(1)}
              >
                <CardIcon path={NEXT_PATH} />
              </button>
            </>
          )}
          <button
            type="button"
            className="card-icon-button"
            aria-label="Close inspector"
            onClick={onClose}
          >
            <CardIcon path={CLOSE_PATH} />
          </button>
        </div>
      </header>

      {(profile.parentIds.length > 0 || profile.childIds.length > 0) && (
        <div className="family">
          <Family profile={profile} fallback={heading} />
        </div>
      )}

      <div className="meters">
        <Meter label="Interest" score={interest} words={interestLabel(interest)} tone="interest" />
        <Meter
          label="Perception"
          score={perception}
          words={perceptionLabel(perception)}
          tone="perception"
        />
      </div>

      {(special.length > 0 || personality.length > 0) && (
        <div className="card-traits">
          <Tags kind="special" label="Special tags">
            {special.map((tag) => (
              <li key={tag.kind} className={`tag tag-special tag-${tag.kind}`} title={tag.meaning}>
                {tag.label}
              </li>
            ))}
          </Tags>
          <Tags kind="personality" label="Personality">
            {personality.map((tag) => (
              <li
                key={tag.trait}
                className={`tag tag-personality tag-${tag.category}`}
                title={tag.meaning}
              >
                {tag.trait}
              </li>
            ))}
          </Tags>
        </div>
      )}

      <div className="action" data-state={activity?.state ?? "idle"}>
        <span className="action-dot" aria-hidden />
        <h3 className="inspector-sr">Current action</h3>
        <span>{action.text}</span>
        {action.partnerId !== undefined && (
          <BlobChip id={action.partnerId} thumbnail fallback={heading} />
        )}
      </div>
    </section>
  );
}
