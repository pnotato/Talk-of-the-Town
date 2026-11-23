/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { nextSpeed, SPEEDS } from "./settings.ts";

test("nextSpeed cycles through the speeds and back to the first", () => {
  assert.deepEqual(
    SPEEDS.map((speed) => nextSpeed(speed)),
    [2, 4, 1],
  );
  // A speed that isn't offered goes back to the start.
  assert.equal(nextSpeed(3), 1);
});
