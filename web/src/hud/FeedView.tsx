import { useMemo, useState } from "react";
import type { RunLog } from "../generated/types.ts";
import { feedAt, postsAt, type FeedItem, type SocialPost, VERDICT_TEXT } from "./feed.ts";
import { ChatIcon, MegaphoneIcon, PackageIcon } from "./icons.tsx";

type Filter = "all" | "news" | "social";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "news", label: "News" },
  { id: "social", label: "Social" },
];

/** Replies shown under a post before the rest fold into a count. */
const SHOWN_REPLIES = 2;

type Entry =
  | { key: string; round: number; rank: number; type: "news"; item: FeedItem }
  | { key: string; round: number; rank: number; type: "post"; post: SocialPost };

/**
 * Newest first. Within a round the company speaks before the town reacts (the announcement and the
 * ship come before the round's posts), so posts rank above shipped above announced.
 */
function merge(items: FeedItem[], posts: SocialPost[]): Entry[] {
  const entries: Entry[] = [
    ...items.map((item) => ({
      key: item.key,
      round: item.round,
      rank: item.kind === "shipped" ? 1 : 0,
      type: "news" as const,
      item,
    })),
    ...posts.map((post) => ({
      key: `post-${post.key}`,
      round: post.round,
      rank: 2,
      type: "post" as const,
      post,
    })),
  ];
  // Stable: posts keep their newest-first order within a round.
  return entries.sort((a, b) => b.round - a.round || b.rank - a.rank);
}

/**
 * The feed, newest first: what the company has announced and shipped so far, as posts from its
 * account, and what the town has posted about it. Shipped features say how they measured up to
 * their claim. A post shows why its author posted it and how the first readers took it.
 */
export default function FeedView({ run, round }: { run: RunLog | null; round: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const items = useMemo(() => (run ? feedAt(run.moments, round) : []), [run, round]);
  const posts = useMemo(() => (run ? postsAt(run, round) : []), [run, round]);
  const company = run?.company ?? "The company";
  const initial = company.charAt(0).toUpperCase();
  const shown = merge(filter === "social" ? [] : items, filter === "news" ? [] : posts);

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
        {shown.length === 0 && filter === "social" ? (
          <div className="panel-empty">
            <span className="panel-empty-icon">
              <ChatIcon />
            </span>
            <p className="panel-empty-title display">No posts yet</p>
            <p>What the town posts about {company} will show up here.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="panel-empty">
            <p className="panel-empty-title display">Quiet for now</p>
            <p>The first announcement lands when the run starts.</p>
          </div>
        ) : (
          <ol className="feed" aria-label="Newest first">
            {shown.map((entry) =>
              entry.type === "post" ? (
                <PostItem key={entry.key} post={entry.post} />
              ) : (
                <NewsItem key={entry.key} item={entry.item} company={company} initial={initial} />
              ),
            )}
          </ol>
        )}
      </div>

      <p className="panel-foot">
        Announcements are auto-picked (the first option) until the newsroom exists.
      </p>
    </>
  );
}

function NewsItem({
  item,
  company,
  initial,
}: {
  item: FeedItem;
  company: string;
  initial: string;
}) {
  return (
    <li className="feed-item" data-kind={item.kind}>
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
  );
}

function PostItem({ post }: { post: SocialPost }) {
  const more = post.replies.length - SHOWN_REPLIES;
  return (
    <li className="feed-item" data-kind="post">
      <span className="feed-avatar" aria-hidden>
        {post.author.charAt(0).toUpperCase()}
        <span className="feed-avatar-badge">
          <ChatIcon />
        </span>
      </span>
      <div className="feed-body">
        <p className="feed-byline">
          <strong>{post.author}</strong>
          <span>Posted · Round {post.round}</span>
        </p>
        <p className="feed-post">{post.words}</p>
        {post.thought && (
          <p className="feed-thought">
            <span>Why</span> {post.thought}
          </p>
        )}
        {post.replies.length > 0 && (
          <ul className="feed-replies" aria-label="How readers took it">
            {post.replies.slice(0, SHOWN_REPLIES).map((reply) => (
              <li key={reply.id}>
                <strong>{reply.name}</strong> {reply.thought}
              </li>
            ))}
            {more > 0 && (
              <li className="feed-replies-more">
                +{more} more {more === 1 ? "reader" : "readers"}
              </li>
            )}
          </ul>
        )}
      </div>
    </li>
  );
}
