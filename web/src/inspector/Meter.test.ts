import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// Node's type stripping doesn't handle JSX; use the app's existing Vite transform, without a
// listening server or a browser, to exercise the actual meter markup.
test("meters show their label and words while keeping accessible scores and descriptions", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, ws: false, watch: null },
  });
  t.after(() => server.close());
  const { default: Meter } = (await server.ssrLoadModule("/src/inspector/Meter.tsx")) as {
    default: typeof import("./Meter.tsx").default;
  };

  for (const props of [
    { label: "Interest", score: 64, words: "Interested", tone: "interest" },
    { label: "Perception", score: 82, words: "Favourable", tone: "perception" },
    { label: "Interest", score: 0, words: "Not interested", tone: "interest" },
    { label: "Perception", score: 100, words: "Favourable", tone: "perception" },
  ] as const) {
    await t.test(`${props.label}: ${props.score}`, () => {
      const html = renderToStaticMarkup(createElement(Meter, props));
      assert.equal(html.replace(/<[^>]*>/g, ""), `${props.label}${props.words}`);
      assert.ok(html.includes(`role="meter" aria-label="${props.label}"`));
      assert.ok(html.includes('aria-valuemin="0" aria-valuemax="100"'));
      assert.ok(html.includes(`aria-valuenow="${props.score}"`));
      assert.ok(html.includes(`aria-valuetext="${props.score} out of 100, ${props.words}"`));
      assert.ok(html.includes(`style="width:${props.score}%"`));
    });
  }
});
