import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { MOOD_COLOR, MOOD_MEANING } from "../scene/blobMood.ts";
import { ageGroup } from "../scene/blobSize.ts";
import BlobPortrait from "../scene/BlobPortrait.tsx";
import BlobPicker from "./BlobPicker.tsx";
import {
  type BlobProfile,
  getProfile,
  PROFILE_NOTE,
  PROFILE_ORDER,
  PROFILE_SOURCE,
  TRAIT_MEANING,
} from "./blobProfiles.ts";
import { useBlobSelection } from "./BlobSelection.tsx";
import {
  activityText,
  capitalise,
  interestLabel,
  perceptionLabel,
  stepSelection,
} from "./inspectorModel.ts";
import Meter from "./Meter.tsx";
import "./inspector.css";

/**
 * A blob named in the inspector (a relative or a partner), as a button that selects it.
 *
 * Selecting or the scene moving on can remove the very button the keyboard is on (a partner who
 * stops talking to the blob, or a relative's link once their own card is showing). When that
 * happens under keyboard focus, focus goes to `fallback` rather than falling to the page. A mouse
 * click never triggers this, so pointer selection doesn't move focus.
 */
function BlobLink({ id, fallback }: { id: number; fallback: RefObject<HTMLElement | null> }) {
  const { selectBlob } = useBlobSelection();
  const profile = getProfile(id);
  const keepKeyboardFocus = useCallback(
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
  if (!profile) return <span>Blob {id}</span>;
  return (
    <button
      ref={keepKeyboardFocus}
      type="button"
      className="inspector-link"
      onClick={() => selectBlob(id)}
    >
      {profile.name}
    </button>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt className="inspector-eyebrow">{label}</dt>
      <dd>{children}</dd>
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
  const { parentIds, childIds } = profile;
  if (parentIds.length === 0 && childIds.length === 0) {
    return <span className="inspector-muted">None listed</span>;
  }
  return (
    <>
      {parentIds.length > 0 && (
        <span className="family-line">
          Child of{" "}
          {parentIds.map((id) => (
            <BlobLink key={id} id={id} fallback={fallback} />
          ))}
        </span>
      )}
      {childIds.length > 0 && (
        <span className="family-line">
          Parent of{" "}
          {childIds.map((id) => (
            <BlobLink key={id} id={id} fallback={fallback} />
          ))}
        </span>
      )}
    </>
  );
}

function Card({ profile, onClose }: { profile: BlobProfile; onClose: () => void }) {
  const { activities } = useBlobSelection();
  const heading = useRef<HTMLHeadingElement>(null);
  const activity = activities[profile.id];
  // The face comes from the scene's activity once it reports; until then, the profile's resting
  // face. The scores below never depend on it.
  const mood = activity?.mood ?? profile.mood;
  const partnerId = activity?.partnerId;

  return (
    <section
      className="inspector-surface inspector-card"
      aria-label={`Selected blob: ${profile.name}`}
    >
      {/* Outside the scrolling part, so closing is always in reach. */}
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

      <div className="card-scroll">
        <div className="card-side">
          <div className="portrait" style={{ borderColor: MOOD_COLOR[mood] }} aria-hidden>
            <BlobPortrait shape={profile.shape} age={profile.age} mood={mood} />
          </div>
          <p className="card-mood">
            <span className="inspector-eyebrow">Mood</span>
            {capitalise(mood)} · {MOOD_MEANING[mood]}
          </p>
        </div>

        <div className="card-main">
          <header className="card-head">
            <h2 ref={heading} tabIndex={-1}>
              {profile.name}
            </h2>
            <p className="card-sub">
              {capitalise(profile.shape)} · {capitalise(ageGroup(profile.age))} · Age {profile.age}
            </p>
          </header>

          <div className="meters">
            <Meter
              label="Perception"
              score={profile.perception}
              words={perceptionLabel(profile.perception)}
              tone="perception"
            />
            <Meter
              label="Interest"
              score={profile.interest}
              words={interestLabel(profile.interest)}
              tone="interest"
            />
            <p className="meters-note">Scores are demo values; scene activity is live.</p>
          </div>

          <dl className="facts">
            <Fact label="Traits">
              <ul className="chips">
                {profile.traits.map((trait) => (
                  <li key={trait} title={TRAIT_MEANING[trait]}>
                    {trait}
                  </li>
                ))}
              </ul>
            </Fact>
            <Fact label="Family">
              <Family profile={profile} fallback={heading} />
            </Fact>
            <Fact label="Activity">{activityText(activity)}</Fact>
            <Fact label="Talking to">
              {partnerId === undefined ? (
                <span className="inspector-muted">Nobody</span>
              ) : (
                <BlobLink id={partnerId} fallback={heading} />
              )}
            </Fact>
          </dl>

          <footer className="card-foot">
            <span className="inspector-badge">SIMULATED</span>
            <span>
              {PROFILE_SOURCE} · {PROFILE_NOTE}
            </span>
          </footer>
        </div>
      </div>
    </section>
  );
}

/**
 * The bottom-left inspector: a bar that is always there (browse, step, hint) with either the
 * selected blob's card or, while browsing, the list of blobs in the card's place. The scene selects
 * by click; everything here works from the keyboard too. Escape closes the list first, then the
 * card.
 *
 * The bar comes first in the DOM (and is drawn at the bottom) so Tab goes from Browse straight into
 * whatever it opened.
 */
export default function BlobInspector() {
  const { selectedId, selectBlob } = useBlobSelection();
  const profile = selectedId === null ? undefined : getProfile(selectedId);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Whether the list was opened from the keyboard, and so should take focus when it appears.
  const [pickerFromKeyboard, setPickerFromKeyboard] = useState(false);
  const dock = useRef<HTMLElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const pickerId = useId();

  // Hands focus to the always-present browse button, but only when it was inside the inspector
  // (so a panel that closes under the keyboard doesn't strand focus, and a mouse click never jumps).
  function keepFocus() {
    if (dock.current?.contains(document.activeElement)) browse.current?.focus();
  }

  function closeCard() {
    keepFocus();
    selectBlob(null);
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
      <div className="inspector-surface inspector-bar">
        <button
          ref={browse}
          type="button"
          className="inspector-button"
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? pickerId : undefined}
          onClick={toggleBrowse}
        >
          Browse blobs
        </button>
        <button
          type="button"
          className="inspector-button inspector-step"
          aria-label="Previous blob"
          onClick={() => selectBlob(stepSelection(PROFILE_ORDER, selectedId, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          className="inspector-button inspector-step"
          aria-label="Next blob"
          onClick={() => selectBlob(stepSelection(PROFILE_ORDER, selectedId, 1))}
        >
          ›
        </button>
        {!profile && !pickerOpen && <span className="bar-hint">Click a blob to inspect it</span>}
      </div>

      {pickerOpen ? (
        <BlobPicker id={pickerId} takeFocus={pickerFromKeyboard} onClose={closePicker} />
      ) : (
        profile && <Card profile={profile} onClose={closeCard} />
      )}

      <p role="status" className="inspector-sr">
        {profile ? `Selected ${profile.name}, ${profile.shape}, age ${profile.age}` : ""}
      </p>
    </aside>
  );
}
