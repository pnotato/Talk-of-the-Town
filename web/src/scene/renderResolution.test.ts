/// <reference types="node" />
// Run: node --test web/src/scene/renderResolution.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_RENDER_PIXELS, renderDpr, subscribeToDevicePixelRatio } from "./renderResolution.ts";

function close(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} ≈ ${expected}`);
}

describe("renderDpr", () => {
  test("uses a 2560 × 1440 pixel budget", () => {
    assert.equal(MAX_RENDER_PIXELS, 2560 * 1440);
  });

  for (const deviceDpr of [1, 2]) {
    test(`renders 4K at DPR ${deviceDpr} below 1 with a roughly 2560 × 1440 buffer`, () => {
      const dpr = renderDpr(3840, 2160, deviceDpr);
      assert.ok(dpr > 0 && dpr < 1);
      close(dpr, 2 / 3);
      close(3840 * dpr, 2560);
      close(2160 * dpr, 1440);
      close(3840 * 2160 * dpr * dpr, MAX_RENDER_PIXELS);
    });
  }

  test("preserves native DPR 1 at 1080p and at the budget boundary", () => {
    assert.equal(renderDpr(1920, 1080, 1), 1);
    assert.equal(renderDpr(2560, 1440, 1), 1);
  });

  test("allows small retina viewports up to DPR 2", () => {
    assert.equal(renderDpr(800, 600, 1.5), 1.5);
    assert.equal(renderDpr(800, 600, 2), 2);
    assert.equal(renderDpr(800, 600, 3), 2);
  });

  test("does not force a native DPR below 1 up to 1", () => {
    assert.equal(renderDpr(800, 600, 0.5), 0.5);
    assert.equal(renderDpr(3840, 2160, 0.5), 0.5);
  });

  test("respects the pixel budget and DPR caps across aspect ratios and device ratios", () => {
    const sizes = [
      [1, 1],
      [320, 568],
      [800, 600],
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
      [2160, 3840],
      [5120, 1440],
      [1440, 5120],
      [7680, 4320],
      [10000, 100],
      [100, 10000],
    ];
    for (const [width, height] of sizes) {
      for (const deviceDpr of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]) {
        const label = `${width} × ${height}, DPR ${deviceDpr}`;
        const dpr = renderDpr(width, height, deviceDpr);
        const pixels = width * height * dpr * dpr;
        assert.ok(Number.isFinite(dpr) && dpr > 0, label);
        assert.ok(dpr <= Math.min(deviceDpr, 2), label);
        assert.ok(pixels <= MAX_RENDER_PIXELS + 1e-6, label);
        if (width * height * Math.min(deviceDpr, 2) ** 2 > MAX_RENDER_PIXELS) {
          close(pixels, MAX_RENDER_PIXELS, label);
        } else {
          assert.equal(dpr, Math.min(deviceDpr, 2), label);
        }
      }
    }
  });

  test("falls back to 1 for invalid dimensions, independently of device DPR", () => {
    for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
      for (const deviceDpr of [0.5, 1, 3, NaN]) {
        assert.equal(renderDpr(invalid, 1080, deviceDpr), 1);
        assert.equal(renderDpr(1920, invalid, deviceDpr), 1);
        assert.equal(renderDpr(invalid, invalid, deviceDpr), 1);
      }
    }
  });

  test("treats invalid device DPR as 1 while still enforcing the pixel budget", () => {
    for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(renderDpr(800, 600, invalid), 1);
      close(renderDpr(3840, 2160, invalid), 2 / 3);
    }
  });
});

function fakeBrowser(devicePixelRatio = 1) {
  const queries: { media: string; listeners: Set<() => void>; fire: () => void }[] = [];
  const browser = {
    devicePixelRatio,
    matchMedia(media) {
      const listeners = new Set<() => void>();
      queries.push({
        media,
        listeners,
        fire() {
          // A newly armed listener must not receive the event being dispatched.
          for (const listener of [...listeners]) listener();
        },
      });
      return {
        media,
        addEventListener(type: string, listener: () => void) {
          assert.equal(type, "change");
          listeners.add(listener);
        },
        removeEventListener(type: string, listener: () => void) {
          assert.equal(type, "change");
          assert.ok(listeners.delete(listener), "removes the registered listener");
        },
      } as MediaQueryList;
    },
  } satisfies Pick<Window, "devicePixelRatio" | "matchMedia">;
  return { browser, queries };
}

describe("subscribeToDevicePixelRatio", () => {
  test("re-arms before notifying for successive 1 → 2 → 1 changes and cleans up", () => {
    const { browser, queries } = fakeBrowser();
    let changes = 0;
    const unsubscribe = subscribeToDevicePixelRatio(() => {
      changes++;
      assert.equal(queries.length, changes + 1, "re-armed before onChange");
      assert.equal(queries[changes - 1].listeners.size, 0, "old listener removed");
      assert.equal(queries[changes].media, `(resolution: ${browser.devicePixelRatio}dppx)`);
      assert.equal(queries[changes].listeners.size, 1, "new listener attached");
    }, browser);

    assert.equal(changes, 0, "subscribing does not notify");
    assert.equal(queries.length, 1);
    assert.equal(queries[0].media, "(resolution: 1dppx)");
    assert.equal(queries[0].listeners.size, 1);

    browser.devicePixelRatio = 2;
    queries[0].fire();
    assert.equal(changes, 1);
    queries[0].fire();
    assert.equal(changes, 1, "stale query no longer notifies");

    browser.devicePixelRatio = 1;
    queries[1].fire();
    assert.equal(changes, 2);
    assert.equal(queries[2].media, "(resolution: 1dppx)");

    unsubscribe();
    assert.ok(queries.every(({ listeners }) => listeners.size === 0));
    for (const query of queries) query.fire();
    assert.equal(changes, 2, "cleanup prevents further notifications");
    assert.equal(queries.length, 3, "cleanup prevents re-arming");
  });

  test("supports StrictMode-style subscribe, cleanup, and resubscribe without leaks", () => {
    const { browser, queries } = fakeBrowser(1.25);
    let changes = 0;
    const onChange = () => changes++;
    const firstCleanup = subscribeToDevicePixelRatio(onChange, browser);
    assert.equal(queries[0].media, "(resolution: 1.25dppx)");
    firstCleanup();
    assert.equal(queries[0].listeners.size, 0);

    const secondCleanup = subscribeToDevicePixelRatio(onChange, browser);
    assert.equal(queries.length, 2);
    assert.equal(queries[1].listeners.size, 1);
    assert.equal(changes, 0);

    browser.devicePixelRatio = 2;
    queries[0].fire();
    assert.equal(changes, 0, "cleaned-up subscription stays inactive");
    queries[1].fire();
    assert.equal(changes, 1, "only the live subscription notifies");
    assert.equal(queries.length, 3);
    assert.equal(queries[2].media, "(resolution: 2dppx)");

    secondCleanup();
    assert.ok(queries.every(({ listeners }) => listeners.size === 0));
    for (const query of queries) query.fire();
    assert.equal(changes, 1);
    assert.equal(queries.length, 3);
  });
});
