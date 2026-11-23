/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isThemeName, revealRadius, startingTheme, THEMES } from "./theme.ts";

test("startingTheme keeps the theme chosen last time", () => {
  assert.equal(startingTheme("tabloid", false), "tabloid");
  assert.equal(startingTheme("matcha", true), "matcha");
});

test("startingTheme follows the system without a saved choice", () => {
  assert.equal(startingTheme(null, false), "sherbet");
  assert.equal(startingTheme(null, true), "midnight");
  // A theme from an older build, or junk, counts as no choice.
  assert.equal(startingTheme("neon", false), "sherbet");
  assert.equal(startingTheme("", true), "midnight");
});

test("isThemeName accepts only the offered themes", () => {
  assert.ok(THEMES.every((t) => isThemeName(t.id)));
  assert.equal(isThemeName("Sherbet"), false);
  assert.equal(isThemeName(undefined), false);
});

test("revealRadius reaches the window's farthest corner", () => {
  assert.equal(revealRadius(0, 0, 300, 400), 500);
  assert.equal(revealRadius(300, 400, 300, 400), 500);
  assert.equal(revealRadius(100, 100, 400, 500), 500);
});

test("every theme but the default has its tokens in index.css", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  for (const { id } of THEMES.slice(1)) {
    assert.ok(css.includes(`[data-theme="${id}"] {`), `index.css has no block for ${id}`);
  }
});
