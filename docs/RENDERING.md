# Rendering resolution

Both 3D scenes use `RenderResolution` to limit their drawing buffers to
`2560 × 1440` pixels in total. This is an area budget, not a fixed aspect ratio.
The effective DPR is the minimum of the native device DPR, 2, and
`sqrt(MAX_RENDER_PIXELS / (cssWidth * cssHeight))`.

A DPR cap of 2 alone still permits 8.3 million pixels at native 4K/DPR 1, or
33.2 million at a 3840 × 2160 CSS viewport/DPR 2. Continuous rendering,
antialiasing, filtered shadows, and the Shapes grid make this resolution-sensitive
work costly. The pixel budget reduces fragment work without changing the scene,
shadow-map resolution, camera controls, or animation timing. It is a starting
quality/performance tradeoff, not a guarantee of 60 FPS on every GPU.

At a 3840 × 2160 CSS viewport, the effective DPR is about 0.667 and the drawing
buffer is 2560 × 1440. Smaller views retain native resolution up to DPR 2 when
within budget. Only the WebGL canvas is downsampled; DOM controls and labels
remain at native resolution. The 3D image can look softer on large displays.

The component reacts to canvas size, device-DPR changes (browser zoom or moving
between displays), and Fiber resetting its DPR during Canvas reconfiguration.
Resolution media queries are re-armed after each change and cleaned up on
unmount. There are no per-frame resolution checks or quality oscillations.

## Verification

`make check` includes the scene tests; `npm --prefix web test` runs them alone.
Resolution tests cover the pixel budget, sub-1 DPR, portrait/ultrawide views,
invalid measurements, repeated DPR notifications, and subscription cleanup.

For browser QA, use a production build on the affected hardware. Record canvas
CSS dimensions, drawing-buffer dimensions, device DPR, browser version, GPU,
and display refresh rate. Physical display resolution alone is insufficient:
OS scaling and browser zoom affect CSS dimensions and DPR.

In the browser console:

```js
const canvas = document.querySelector("canvas");
console.log({
  css: canvas.getBoundingClientRect().toJSON(),
  buffer: [canvas.width, canvas.height],
  pixels: canvas.width * canvas.height,
  nativeDpr: window.devicePixelRatio,
});
```

Exercise both `#/town` and `#/shapes`:

- At CSS 3840 × 2160 with native DPR 1 and 2, expect about 2560 × 1440 buffers.
- Resize the same canvas to CSS 1920 × 1080/DPR 1; expect 1920 × 1080.
- At CSS 800 × 600, move between DPR 1 and 2 displays repeatedly without resizing;
  expect 800 × 600 and 1600 × 1200 buffers respectively.
- At DPR 2, resize from CSS 800 × 600 to 900 × 600; expect 1600 × 1200 and
  1800 × 1200 even though the desired DPR remains 2.
- Verify a parent rerender does not restore DPR 1 and exceed the budget at 4K.
- Pan, zoom, and watch idle animations. Compare frame-time distributions against
  the unmodified build with the same framing and hardware; a 60 Hz target has
  about 16.7 ms per frame. Check visual quality, label alignment, and picking.

Headless/software-rendered checks can verify buffer sizes, not GPU performance.
CDP device-metric emulation may not dispatch resolution-media-query changes
until a CSS resize, so physical-display DPR-only transitions still need manual QA.
