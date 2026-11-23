import { useMemo, useState } from "react";
import type { RunLog } from "../generated/types.ts";
import { feedAt, VERDICT_TEXT } from "./feed.ts";
import { ChatIcon, MegaphoneIcon, PackageIcon } from "./icons.tsx";

type Filter = "all" | "news" | "social";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "news", label: "News" },
  { id: "social", label: "Social" },
];

/**
 * The feed, newest first: what the company has announced and shipped so far, as posts from its
 * account. Shipped features say how they measured up to their claim. Social posts will join the
 * same timeline (and get the Social filter to themselves) once the sim writes them; until then
 * that filter explains it is empty.
 */
export default function FeedView({ run, round }: { run: RunLog | null; round: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const items = useMemo(() => (run ? feedAt(run.moments, round) : []), [run, round]);
  const company = run?.company ?? "The company";
  const initial = company.charAt(0).toUpperCase();
  const shown = filter === "social" ? [] : items;

  return (
    <>
      <div className="panel-tools">
        <div className="segmented" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-scroll">
        {filter === "social" ? (
          <div className="panel-empty">
            <span className="panel-empty-icon">
              <ChatIcon />
            </span>
            <p className="panel-empty-title">No posts yet</p>
            <p>What the town posts about {company} will show up here.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="panel-empty">
            <p className="panel-empty-title">Quiet for now</p>
            <p>The first announcement lands when the run starts.</p>
          </div>
        ) : (
          <ol className="feed" aria-label="Newest first">
            {shown.map((item) => (
              <li key={item.key} className="feed-item" data-kind={item.kind}>
                <span className="feed-avatar" aria-hidden>
                  {initial}
                  <span className="feed-avatar-badge">
                    {item.kind === "shipped" ? <PackageIcon /> : <MegaphoneIcon />}
                  </span>
                </span>
                <div className="feed-body">
                  <p className="feed-byline">
                    <strong>{company}</strong>
                    <span>
                      {item.kind === "shipped" ? "Shipped" : "Announced"} · Round {item.round}
                    </span>
                  </p>
                  <p className="feed-text">{item.headline}</p>
                  {item.verdict && (
                    <p className="feed-verdict" data-verdict={item.verdict}>
                      <strong>{VERDICT_TEXT[item.verdict]}</strong>
                      <span>
                        Claimed {item.claimed} · Delivered {item.delivered}
                      </span>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="panel-foot">
        Announcements are auto-picked (the first option) until the newsroom exists.
      </p>
    </>
  );
}
