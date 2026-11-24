import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RunLog } from "../generated/types.ts";
import BlobCard from "../inspector/BlobCard.tsx";
import { useBlobSelection } from "../inspector/BlobSelection.tsx";
import { stepSelection } from "../inspector/inspectorModel.ts";
import { feedAt, headlineAt } from "./feed.ts";
import FeedView from "./FeedView.tsx";
import { BrandMark, CloseIcon, FeedIcon, MegaphoneIcon, PeopleIcon } from "./icons.tsx";
import PeopleView from "./PeopleView.tsx";
import SettingsMenu, { type Connection } from "./SettingsMenu.tsx";
import type { MapName } from "./settings.ts";
import Transport from "./Transport.tsx";
import "./hud.css";

type View = "feed" | "people";

const VIEW_TITLE: Record<View, string> = { feed: "Feed", people: "People" };

// Where Space must keep its own meaning instead of playing or pausing.
const INTERACTIVE = "button, a, input, textarea, select, summary, [contenteditable], [role=button]";

/** The drawer on the right: a title, a close button and the view's own tools and list. */
function SidePanel({
  id,
  title,
  subtitle,
  heading,
  onClose,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  heading: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside id={id} className="hud-panel hud-sheet" aria-labelledby={`${id}-title`}>
      <header className="panel-head">
        <div>
          <h2 id={`${id}-title`} className="display" ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <p>{subtitle}</p>
        </div>
        <button
          type="button"
          className="panel-close"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      {children}
    </aside>
  );
}

/**
 * Everything drawn over the replay, laid out so the town stays the picture and each edge has one
 * job:
 *
 * - top left: who you are (the game, the SIMULATED label, the company), and under it the selected
 *   blob's card;
 * - top centre: the story the town is passing round (pressing it opens the feed);
 * - top right: Feed, People and Settings;
 * - right: one drawer, holding either the feed or the people directory;
 * - bottom centre: playback, whose track charts the town's scores as the run plays.
 *
 * Escape closes the innermost thing first (the settings popover closes itself, then the drawer
 * when focus is in it, then the card, then the drawer). Space plays and pauses unless focus is on
 * something Space already works.
 */
export default function GameHud({
  run,
  error,
  onRetry,
  round,
  ended,
  playing,
  onTogglePlay,
  speed,
  onSpeed,
  map,
  onMap,
  seed,
  onNewSeed,
  grid,
  onGrid,
}: {
  run: RunLog | null;
  /** Why the run failed, or null. With neither a run nor an error, the run is loading. */
  error: string | null;
  onRetry: () => void;
  round: number;
  ended: boolean;
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeed: (speed: number) => void;
  map: MapName;
  onMap: (map: MapName) => void;
  seed: number;
  onNewSeed: () => void;
  grid: boolean;
  onGrid: (grid: boolean) => void;
}) {
  const { selectedId, selectBlob, focusBlob, catalog } = useBlobSelection();
  const profile = selectedId === null ? undefined : catalog.get(selectedId);
  const [view, setView] = useState<View | null>(null);
  const panelId = useId();
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const tools = { feed: useRef<HTMLButtonElement>(null), people: useRef<HTMLButtonElement>(null) };
  // Set when the drawer was opened from the keyboard, so its title takes focus once it appears.
  const panelTakesFocus = useRef(false);

  const items = useMemo(() => (run ? feedAt(run.moments, round) : []), [run, round]);
  const headline = run ? headlineAt(run.moments, round) : undefined;
  const connection: Connection = run ? "online" : error ? "offline" : "pending";
  const label = run?.label ?? "Simulated";

  // The feed button shows a dot for news that arrived while the feed was closed. A new run (or
  // map) starts unread.
  const runKey = run ? `${run.seed}/${map}` : "";
  const [seen, setSeen] = useState({ key: "", count: 0 });
  if (view === "feed" && (seen.key !== runKey || seen.count !== items.length)) {
    setSeen({ key: runKey, count: items.length });
  }
  const unread = view !== "feed" && items.length > (seen.key === runKey ? seen.count : 0);

  // The hint stays until the first blob is chosen.
  const [hinted, setHinted] = useState(false);
  if (selectedId !== null && !hinted) setHinted(true);

  useEffect(() => {
    if (view && panelTakesFocus.current) panelHeading.current?.focus();
    panelTakesFocus.current = false;
  }, [view]);

  function openView(next: View, viaKeyboard: boolean) {
    panelTakesFocus.current = viaKeyboard;
    setView(next);
  }

  function toggleView(next: View, event: MouseEvent<HTMLButtonElement>) {
    // A click from the keyboard (Enter or Space) has no pointer position: its `detail` is 0.
    if (view === next) closePanel();
    else openView(next, event.detail === 0);
  }

  // Focus inside the drawer goes back to the button that opened it, never to the page.
  function closePanel() {
    if (view && panel.current?.contains(document.activeElement)) tools[view].current?.focus();
    setView(null);
  }

  function closeCard() {
    if (card.current?.contains(document.activeElement)) tools.people.current?.focus();
    selectBlob(null);
  }

  function step(direction: 1 | -1) {
    const id = stepSelection(catalog.order, selectedId, direction);
    if (id !== null) focusBlob(id);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === "Escape") {
        // The settings popover closes itself on Escape; let it.
        if (document.querySelector(":popover-open")) return;
        // A search box with text clears itself first.
        if (target instanceof HTMLInputElement && target.type === "search" && target.value) return;
        if (view && panel.current?.contains(document.activeElement)) closePanel();
        else if (selectedId !== null) closeCard();
        else if (view) closePanel();
        else return;
        event.preventDefault();
        return;
      }
      if (event.code === "Space" && run && !event.repeat) {
        if (event.metaKey || event.ctrlKey || event.altKey || target?.closest(INTERACTIVE)) return;
        event.preventDefault();
        onTogglePlay();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const subtitle =
    view === "people"
      ? `${catalog.order.length} residents · live moods`
      : `What ${run?.company ?? "the company"} has said and shipped, and what the town posts`;

  return (
    <div className="hud" data-panel={view ? "open" : "closed"}>
      <div className="hud-top">
        <div className="hud-brand hud-glass">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-title display">
              Talk <em>of the</em> Town
            </span>
            <span className="brand-kicker">
              {label}
              {run && ` · ${run.company}`}
            </span>
          </span>
        </div>

        <nav className="hud-toolbar hud-glass" aria-label="Panels">
          {(["feed", "people"] as const).map((v) => (
            <button
              key={v}
              ref={tools[v]}
              type="button"
              className="hud-tool"
              aria-pressed={view === v}
              aria-controls={view === v ? panelId : undefined}
              aria-label={v === "feed" && unread ? "Feed, new announcement" : VIEW_TITLE[v]}
              data-tip={VIEW_TITLE[v]}
              onClick={(event) => toggleView(v, event)}
            >
              {v === "feed" ? <FeedIcon /> : <PeopleIcon />}
              {v === "feed" && unread && <span className="hud-badge" aria-hidden />}
            </button>
          ))}
          <SettingsMenu
            map={map}
            onMap={onMap}
            seed={seed}
            onNewSeed={onNewSeed}
            grid={grid}
            onGrid={onGrid}
            connection={connection}
            label={label}
          />
        </nav>
      </div>

      {/* The story everyone is passing round. It hides while the feed, which leads with it, is open. */}
      <div className="hud-headline-slot" aria-live="polite">
        {headline && view !== "feed" && (
          <button
            key={headline.id}
            type="button"
            className="hud-headline hud-glass"
            onClick={(event) => openView("feed", event.detail === 0)}
          >
            <span className="headline-icon" aria-hidden>
              <MegaphoneIcon />
            </span>
            <span className="headline-text">
              <span className="headline-kicker">
                Round {headline.round + 1} · The talk of the town
              </span>
              <span className="headline-title">{headline.headline}</span>
            </span>
          </button>
        )}
      </div>

      {profile ? (
        <div ref={card} className="hud-card">
          <BlobCard profile={profile} onClose={closeCard} onStep={step} />
        </div>
      ) : (
        run &&
        !hinted && (
          <p className="hud-hint hud-glass">
            <span className="hint-dot" aria-hidden />
            Click any blob to see what they think
          </p>
        )
      )}

      {view && (
        <div ref={panel} className="hud-panel-slot">
          <SidePanel
            id={panelId}
            title={VIEW_TITLE[view]}
            subtitle={subtitle}
            heading={panelHeading}
            onClose={closePanel}
          >
            {view === "feed" ? <FeedView run={run} round={round} /> : <PeopleView />}
          </SidePanel>
        </div>
      )}

      <div className="hud-bottom">
        <Transport
          run={run}
          round={round}
          ended={ended}
          playing={playing}
          speed={speed}
          onTogglePlay={onTogglePlay}
          onSpeed={onSpeed}
        />
      </div>

      {!run && !error && (
        <p role="status" className="hud-notice hud-glass">
          <span className="notice-spinner" aria-hidden />
          Simulating the town…
        </p>
      )}
      {error && (
        <div role="alert" className="hud-notice hud-glass">
          <span>{error}</span>
          <button type="button" className="hud-button hud-button-strong" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
