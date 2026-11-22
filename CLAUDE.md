# CLAUDE.md

Guidance for coding agents working in this repo. Many agents work in parallel, each on its own PR. Read this whole file before starting.

## What this is

**Talk of the Town** is a population simulation game. The player runs communications for a **fictional** tech/AI company and announces new features. A town of ~100 "blobs" (personas representative of the Canadian population) passes the news around through word of mouth and social media, and the story distorts as it spreads.

Bold claims raise interest quickly, but they backfire when the shipped feature doesn't live up to what people *heard*. Honest claims are slower but hold up. The point is educational: show how hype and misinformation distort public perception of a company.

There's no win or lose. The player aims for both **perception** and **interest** to be high at the end.

## Blobs

```json
{ "id": 3, "name": "Bob Pickle", "shape": "triangle", "age": 20,
  "traits": ["skeptic", "recluse"], "perception": 50, "interest": 20 }
```

- `shape`: culture. Sets who the blob trusts most. Size shows age/family.
- `age`: exact number, grouped as child 0–17 (~20%), adult 18–64 (~60%), elder 65+ (~20%).
- `traits`: usually 2 tags (1–3). Each category has a low and high tag; no tag = average.
  - Credulity: `skeptic` / `gullible` (how easily they believe)
  - Socialness: `quiet` / `chatty` (how often they pass things on)
  - Persuasiveness: `unconvincing` / `charismatic` (how much others believe them)
  - Special: `family-oriented`, `recluse`, `leader`
- `perception` (starts 50) and `interest` (starts 20) are separate scores, 0–100. A blob can talk about the company a lot while thinking little of it.

Names are fictional. All companies are fictional.

## Game loop

- Each round, a weighted random set of blobs talks one-to-one, some post to social media instead, and the rest idle.
- After each round every blob reports its perception and interest. Town averages are recorded and plotted per round.
- A run lasts **50 rounds**. Every **10 rounds** the player picks a news story/announcement, which shifts the blobs.

## Stack

- **Go** backend runs the simulation and makes any model calls. **React + TypeScript** client (Vite, React Three Fiber) replays the result.

```
cmd/server/        HTTP server entrypoint (serves /api, plus web/dist when built)
internal/sim/      Pure, deterministic simulation. Standard library only, no I/O.
internal/server/   HTTP routes; thin, calls into sim + provider
internal/provider/ Model providers: stub (default), anthropic
web/               React + Vite + TS client (own package.json)
```

Dependency direction: `cmd → internal/server → internal/sim`. `internal/provider` implements an interface that `sim` defines.

The **RunLog JSON** is the contract between Go and TS. Go structs in `internal/sim` are the source of truth; TS types are generated from them, never hand-edited.

## Hard rules

1. **No API keys in the browser.** Only the Go server reads secrets, from the environment.
2. **Stub brain by default.** Dev, tests and CI use the deterministic stub provider and cost $0. Real model calls need `BRAIN=anthropic` set explicitly (model `claude-haiku-5-5`).
3. **The sim is the source of truth; the UI only replays it.** The client sends back only the player's choices.
4. **Cap spend.** Real runs have a hard config limit on rounds and agents; the server refuses runs past it.
5. Prefer the standard library. Don't add a dependency without saying why in the PR.

## Git and PR workflow

- **Never commit to `main` directly.** Every task gets its own branch and its own git worktree:
  ```
  git fetch origin
  git worktree add ../tot-<short-slug> -b <short-slug> origin/main
  ```
  Do all work inside that worktree, push the branch, and open a PR with `gh pr create`.
- **One task per branch and PR.** Keep PRs small and reviewable. Don't touch files outside your task.
- Stage only the files you changed. Leave other uncommitted work alone.
- Before pushing, run the checks (`make check`). Write tests first for sim logic.
- Remove your worktree after the PR is merged or closed (`git worktree remove ../tot-<short-slug>`).

## Commands

```
make dev     # Go server on :8080 + Vite on :5173 (proxies /api)
make check   # gofmt, go vet, go test, tsc, oxlint, prettier. Must pass before a PR is ready
make fmt
make test
make build   # web/dist + bin/server; ./bin/server then serves everything on :8080
```

`make` loads `.env` (copy from `.env.example`). Go 1.26, Node 26.
