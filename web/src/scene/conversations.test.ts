/// <reference types="node" />
// Run: node --test web/src/scene/conversations.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { RunLog } from "../generated/types.ts";
import { stageRun } from "./conversations.ts";
import { SPOT_SPACING } from "./mapLayout.ts";

// The golden run (internal/sim/testdata), as the server sends it: 100 blobs walking the city for
// 50 rounds, with the talks the sim decided each round.
const GOLDEN = JSON.parse(
  readFileSync(new URL("../../../internal/sim/testdata/golden_run.json", import.meta.url), "utf8"),
) as RunLog;

describe("stageRun", () => {
  const staged = stageRun(GOLDEN);

  test("gives each round a stage for every blob", () => {
    assert.equal(staged.length, GOLDEN.rounds.length);
    for (const [r, round] of staged.entries()) {
      assert.equal(round.blobs.length, GOLDEN.town.blobs.length, `round ${r}`);
    }
  });

  test("stages only in-person talks the sim recorded", () => {
    GOLDEN.rounds.forEach((round, r) => {
      const talks = new Set(
        round.events
          .filter((e) => !e.p && !e.s && e.to.length === 1)
          .map((e) => `${e.f}>${e.to[0]}`),
      );
      for (const { speaker, listener } of staged[r].conversations) {
        assert.ok(talks.has(`${speaker}>${listener}`), `round ${r}: ${speaker} → ${listener}`);
      }
    });
  });

  test("never stages a blob twice in a round, or one that posts or scrolls", () => {
    for (const [r, round] of staged.entries()) {
      const seen = new Set<number>();
      for (const { speaker, listener } of round.conversations) {
        for (const b of [speaker, listener]) {
          assert.ok(!seen.has(b), `round ${r}: blob ${b} staged twice`);
          seen.add(b);
        }
      }
      const posters = new Set(GOLDEN.rounds[r].events.filter((e) => e.p || e.s).map((e) => e.f));
      for (const b of seen)
        assert.ok(!posters.has(b), `round ${r}: poster or scroller ${b} is staged`);
    }
  });

  test("stands each pair on two adjacent hex cells, and no cell twice", () => {
    for (const [r, round] of staged.entries()) {
      const cells = new Set<number>();
      for (const { speakerNode, listenerNode } of round.conversations) {
        assert.notEqual(speakerNode, listenerNode, `round ${r}`);
        const [px, pz] = GOLDEN.map.nodes[speakerNode];
        const [qx, qz] = GOLDEN.map.nodes[listenerNode];
        const gap = Math.hypot(px - qx, pz - qz);
        assert.ok(
          Math.abs(gap - SPOT_SPACING) <= 0.06,
          `round ${r}: cells ${gap.toFixed(3)} apart`,
        );
        for (const node of [speakerNode, listenerNode]) {
          assert.ok(node < GOLDEN.map.stand, `round ${r}: node ${node} is a standing spot`);
          assert.ok(!cells.has(node), `round ${r}: cell ${node} reused`);
          cells.add(node);
        }
      }
    }
  });

  test("gives both halves of a pair a role pointing at each other", () => {
    for (const round of staged) {
      for (const { speaker, listener, speakerNode, listenerNode } of round.conversations) {
        assert.deepEqual(round.blobs[speaker].role, {
          speaker: true,
          partner: listener,
          node: speakerNode,
        });
        assert.deepEqual(round.blobs[listener].role, {
          speaker: false,
          partner: speaker,
          node: listenerNode,
        });
      }
    }
  });

  test("carries each blob from a round's end to the next round's start", () => {
    for (let r = 1; r < staged.length; r++) {
      for (let b = 0; b < GOLDEN.town.blobs.length; b++) {
        assert.deepEqual(
          staged[r].blobs[b].from,
          staged[r - 1].blobs[b].end,
          `round ${r} blob ${b}`,
        );
      }
    }
  });

  test("starts round 0 where the run starts everyone", () => {
    for (let b = 0; b < GOLDEN.town.blobs.length; b++) {
      const [x, z] = GOLDEN.map.nodes[GOLDEN.start[b]];
      assert.deepEqual(staged[0].blobs[b].from, { x, z });
    }
  });

  test("leaves a blob's end on its sim path when it is not talking", () => {
    for (const [r, round] of staged.entries()) {
      round.blobs.forEach((blob, b) => {
        if (blob.role) return;
        const path = GOLDEN.rounds[r].paths[b];
        const [x, z] = GOLDEN.map.nodes[path[path.length - 1]];
        assert.deepEqual(blob.end, { x, z }, `round ${r} blob ${b}`);
      });
    }
  });

  test("is deterministic", () => {
    assert.deepEqual(stageRun(GOLDEN), staged);
  });

  test("has nothing to stage before any round", () => {
    assert.deepEqual(stageRun({ ...GOLDEN, rounds: [] }), []);
  });
});
