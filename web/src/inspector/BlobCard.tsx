import { type ReactNode, type RefObject, useCallback, useEffect, useRef } from "react";
import { MOOD_COLOR, MOOD_MEANING } from "../scene/blobMood.ts";
import { ageGroup } from "../scene/blobSize.ts";
import BlobPortrait from "../scene/BlobPortrait.tsx";
import { type BlobProfile, getProfile, PROFILE_NOTE, PROFILE_SOURCE } from "./blobProfiles.ts";
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
  const { focusBlob, activities } = useBlobSelection();
  const rescue = useKeyboardFocusRescue(fallback);
  const profile = getProfile(id);
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
  if (groups.length === 0) return <span className="inspector-muted">No family listed</span>;

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
  empty,
  children,
}: {
  kind: "special" | "personality";
  label: string;
  empty: string;
  children: ReactNode[];
}) {
  return (
    <div className={`tag-row tag-row-${kind}`}>
      <h3 className="inspector-eyebrow">{label}</h3>
      {children.length > 0 ? (
        <ul className="tags">{children}</ul>
      ) : (
        <span className="inspector-muted tag-empty">{empty}</span>
      )}
    </div>
  );
}

/**
 * The selected blob's profile: a wide, low panel with the blob's portrait overlapping its left
 * edge. Top to bottom: name, age and family, special tags, the two meters, personality tags, and
 * the current action with whoever the blob is talking with. The portrait and every named blob are
 * buttons that take the camera to that blob.
 *
 * Scores and the profile are authored sandbox data; the face, action and partner come from the
 * scene's live activity report.
 */
export default function BlobCard({
  profile,
  onClose,
  takeFocus,
}: {
  profile: BlobProfile;
  onClose: () => void;
  /** Asked once when the card appears: true puts keyboard focus on the name (a keyboard pick). */
  takeFocus?: () => boolean;
}) {
  const { activities, focusBlob } = useBlobSelection();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (takeFocus?.()) heading.current?.focus();
    // On appearing only: later renders mustn't pull focus.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const activity = activities[profile.id];
  // The face comes from the scene's activity once it reports; until then, the profile's resting
  // face. The scores never depend on it.
  const mood = activity?.mood ?? profile.mood;
  const action = describeAction(activity);
  const special = specialTags(profile);
  const personality = personalityTags(profile);

  return (
    <section className="inspector-card" aria-label={`Selected blob: ${profile.name}`}>
      {/* Sticks to the top of the scrolling card, so closing is always in reach. */}
      <div className="card-close-anchor">
        <button
          type="button"
          className="inspector-close"
          aria-label="Close inspector"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
            <path
              d="M3 3l10 10M13 3L3 13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="card-portrait">
        {/* The button lies over the portrait: a canvas can't sit inside a button. */}
        <button
          type="button"
          className="portrait-hit"
          aria-label={`Go to ${profile.name}`}
          onClick={() => focusBlob(profile.id)}
        />
        <div className="portrait" style={{ borderColor: MOOD_COLOR[mood] }} aria-hidden>
          <BlobPortrait shape={profile.shape} age={profile.age} mood={mood} />
        </div>
        <p className="portrait-mood" title={MOOD_MEANING[mood]}>
          <span
            className="portrait-mood-dot"
            style={{ background: MOOD_COLOR[mood] }}
            aria-hidden
          />
          {capitalise(mood)}
        </p>
      </div>

      <div className="inspector-surface card-panel">
        <header className="card-head">
          <h2 ref={heading} tabIndex={-1}>
            {profile.name}
          </h2>
          <span className="card-rule" aria-hidden />
        </header>

        <div className="card-meta">
          <p>
            Age {profile.age} · {capitalise(ageGroup(profile.age))} · {capitalise(profile.shape)}
          </p>
          <div className="family">
            <Family profile={profile} fallback={heading} />
          </div>
        </div>

        <Tags kind="special" label="Special tags" empty="None">
          {special.map((tag) => (
            <li key={tag.kind} className={`tag tag-special tag-${tag.kind}`} title={tag.meaning}>
              {tag.label}
            </li>
          ))}
        </Tags>

        <div className="meters">
          <Meter
            label="Interest"
            score={profile.interest}
            words={interestLabel(profile.interest)}
            tone="interest"
          />
          <Meter
            label="Perception"
            score={profile.perception}
            words={perceptionLabel(profile.perception)}
            tone="perception"
          />
        </div>

        <Tags kind="personality" label="Personality" empty="No personality tags">
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

        <footer className="card-foot">
          <div className="action">
            <h3 className="inspector-eyebrow">Current action</h3>
            <div className="action-line">
              <span>{action.text}</span>
              {action.partnerId !== undefined && (
                <BlobChip id={action.partnerId} thumbnail fallback={heading} />
              )}
            </div>
          </div>
          <p className="card-note">
            <span className="inspector-badge">SIMULATED</span>
            {PROFILE_SOURCE} · {PROFILE_NOTE} · Scores are demo values; scene activity is live.
          </p>
        </footer>
      </div>
    </section>
  );
}
