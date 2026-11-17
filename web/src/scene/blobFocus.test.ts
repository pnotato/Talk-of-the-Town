/// <reference types="node" />
// Run: node --test web/src/scene/blobFocus.test.ts (Node strips the types natively).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import {
  type Pose,
  blobObjectName,
  GIVE_UP,
  cancelFlight,
  clearBand,
  createFlight,
  createSession,
  defaultInset,
  ease,
  finishFlight,
  fitBlobDistance,
  flightDuration,
  focusDistance,
  keepWaiting,
  neighbourhoodDistance,
  receive,
  reframed,
  resolveInset,
  safeInset,
  startFlight,
  started,
  stepFlight,
  takenOver,
  viewShift,
} from "./blobFocus.ts";

const FOV = 26;
const pose = (x: number, y: number, z: number, distance: number, shift = 0): Pose => ({
  x,
  y,
  z,
  distance,
  shift,
});
const out = pose(0, 0, 0, 0);

describe("blobObjectName", () => {
  test("is unique per blob id, so the camera finds the right root", () => {
    assert.equal(blobObjectName(7), "blob-7");
    assert.notEqual(blobObjectName(1), blobObjectName(11));
    assert.notEqual(blobObjectName(210), blobObjectName(211));
  });
});

describe("neighbourhoodDistance", () => {
  test("stands further back on a narrow screen, within limits", () => {
    const wide = neighbourhoodDistance(FOV, 1.8);
    const tall = neighbourhoodDistance(FOV, 0.5);
    assert.ok(wide < tall);
    for (const aspect of [0.2, 0.5, 1, 2, 4]) {
      const d = neighbourhoodDistance(FOV, aspect);
      assert.ok(d >= 10 && d <= 18, `aspect ${aspect}: ${d}`);
    }
  });

  test("copes with a canvas that has not been measured", () => {
    for (const aspect of [0, NaN, Infinity]) {
      assert.ok(Number.isFinite(neighbourhoodDistance(FOV, aspect)));
    }
  });
});

describe("focusDistance", () => {
  test("zooms in from far out, but never out from close in when the blob fits", () => {
    assert.equal(focusDistance(40, 12, 5, 3, 60), 12);
    assert.equal(focusDistance(6, 12, 5, 3, 60), 6);
  });

  test("stands back when the blob would not fit the clear band", () => {
    assert.equal(focusDistance(6, 12, 9, 3, 60), 9);
    assert.equal(focusDistance(40, 12, 20, 3, 60), 20);
  });

  test("stays within the controls' range", () => {
    assert.equal(focusDistance(40, 2, 0, 3, 60), 3);
    assert.equal(focusDistance(80, 90, 0, 3, 60), 60);
    assert.equal(focusDistance(10, 12, 500, 3, 60), 60);
  });
});

describe("resolveInset", () => {
  test("uses what the page reported, and guesses only what is missing", () => {
    assert.deepEqual(resolveInset(1440, 900, { top: 112, bottom: 410 }), { top: 112, bottom: 410 });
    const guess = defaultInset(1440, 900);
    assert.deepEqual(resolveInset(1440, 900), guess);
    assert.deepEqual(resolveInset(1440, 900, { top: 112 }), { top: 112, bottom: guess.bottom });
  });

  test("turns negative and non-finite numbers into 0", () => {
    assert.deepEqual(resolveInset(900, 700, { top: -5, bottom: NaN }), { top: 0, bottom: 0 });
    assert.deepEqual(resolveInset(900, 700, { bottom: Infinity }).bottom, 0);
  });
});

describe("safeInset", () => {
  test("honours valid insets exactly, however thin the clear band", () => {
    assert.deepEqual(safeInset(800, { top: 112, bottom: 500 }), { top: 112, bottom: 500 });
    assert.deepEqual(safeInset(390, { top: 112, bottom: 222 }), { top: 112, bottom: 222 });
    assert.deepEqual(safeInset(568, { top: 112, bottom: 375 }), { top: 112, bottom: 375 });
    assert.equal(clearBand(390, { top: 112, bottom: 222 }), 56);
    assert.equal(clearBand(568, { top: 112, bottom: 375 }), 81);
    assert.deepEqual(safeInset(900, { top: 112, bottom: 660 }), { top: 112, bottom: 660 });
  });

  test("honours a band of a single pixel, but no thinner", () => {
    assert.deepEqual(safeInset(600, { top: 100, bottom: 499 }), { top: 100, bottom: 499 });
    assert.equal(clearBand(600, { top: 100, bottom: 499 }), 1);
  });

  test("only changes invalid insets: negative, oversized, overlapping or filling the canvas", () => {
    assert.deepEqual(safeInset(600, { top: -10, bottom: 50 }), { top: 0, bottom: 50 });
    assert.deepEqual(safeInset(600, { top: 100, bottom: 5000 }), { top: 100, bottom: 499 });
    // Overlap: the bottom gives way first, then the top.
    assert.deepEqual(safeInset(600, { top: 112, bottom: 560 }), { top: 112, bottom: 487 });
    assert.deepEqual(safeInset(600, { top: 590, bottom: 100 }), { top: 590, bottom: 9 });
    assert.deepEqual(safeInset(600, { top: 700, bottom: 700 }), { top: 599, bottom: 0 });
  });

  test("always leaves a positive band, for any numbers", () => {
    for (const [top, bottom] of [
      [0, 0],
      [1e6, 1e6],
      [50, 2000],
      [300, 300],
      [112, 488],
    ]) {
      assert.ok(clearBand(600, { top, bottom }) >= 1, `${top}, ${bottom}`);
    }
    assert.ok(clearBand(0.5, { top: 1, bottom: 1 }) >= 0);
  });
});

describe("fitBlobDistance", () => {
  const args = [1.2, 0.6, (40 * Math.PI) / 180, FOV] as const;

  test("stands further back as the clear band shrinks", () => {
    assert.ok(fitBlobDistance(...args, 800, 120) > fitBlobDistance(...args, 800, 400));
  });

  test("puts the blob inside the band, root to head, with some room", () => {
    const [height, radius, elevation] = args;
    const [canvas, band] = [800, 200];
    const d = fitBlobDistance(...args, canvas, band);
    const pixelsPerUnit = canvas / (2 * d * Math.tan((FOV / 2) * (Math.PI / 180)));
    const shown = height * Math.cos(elevation) + 2 * radius * Math.sin(elevation);
    assert.ok(shown * pixelsPerUnit <= band + 1e-9);
    assert.ok(shown * pixelsPerUnit >= band * 0.7);
  });

  test("fits the blob into the actual band however thin, not a minimum", () => {
    const d56 = fitBlobDistance(...args, 390, 56);
    const d120 = fitBlobDistance(...args, 390, 120);
    assert.ok(d56 > 2 * d120 - 1e-9, "a 56px band needs over twice the distance of a 120px one");
  });

  test("copes with an empty band", () => {
    assert.ok(Number.isFinite(fitBlobDistance(...args, 800, 0)));
  });
});

describe("viewShift", () => {
  test("is half what the HUD covers beyond the shell, and never negative", () => {
    assert.equal(viewShift(900, { top: 64, bottom: 300 }), 118);
    assert.equal(viewShift(900, { top: 0, bottom: 0 }), 0);
    assert.equal(viewShift(900, { top: 300, bottom: 64 }), 0);
  });

  test("follows a tall measured HUD instead of capping it", () => {
    assert.equal(viewShift(900, { top: 112, bottom: 640 }), 264);
  });

  // Where the camera's aim lands, in pixels from the top of the canvas, after the shift.
  const aimFromTop = (height: number, inset: { top: number; bottom: number }) =>
    height / 2 - viewShift(height, inset);

  test("aims at the middle of the actual band on a short phone in landscape (844x390)", () => {
    const inset = { top: 112, bottom: 222 };
    assert.equal(aimFromTop(390, inset), 140);
    assert.notEqual(aimFromTop(390, inset), 172, "172 is behind the HUD, which starts at 168");
    assert.ok(aimFromTop(390, inset) > inset.top && aimFromTop(390, inset) < 390 - inset.bottom);
  });

  test("aims at the middle of the actual band on a small phone (320x568)", () => {
    const inset = { top: 112, bottom: 375 };
    assert.equal(aimFromTop(568, inset), 152.5);
    assert.ok(aimFromTop(568, inset) < 568 - inset.bottom - 30, "well clear of the HUD");
  });

  test("keeps the aim inside the band for any valid insets", () => {
    for (const [height, top, bottom] of [
      [390, 112, 222],
      [568, 112, 375],
      [900, 112, 660],
      [700, 64, 300],
    ]) {
      const aim = aimFromTop(height, { top, bottom });
      assert.ok(aim >= top && aim <= height - bottom, `${height}: ${aim}`);
    }
  });

  test("is a bigger shift on a tall screen, whose panel is taller", () => {
    const wide = defaultInset(1440, 900);
    const tall = defaultInset(390, 844);
    assert.ok(wide.bottom >= 250 && wide.bottom <= 320, `wide ${wide.bottom}`);
    assert.ok(viewShift(844, tall) > viewShift(900, wide));
  });

  test("lands the camera's aim in the middle of the canvas left between the insets", () => {
    const [width, height] = [900, 700];
    const inset = { top: 64, bottom: 280 };
    const camera = new PerspectiveCamera(FOV, width / height, 0.1, 100);
    camera.position.set(0, 6, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const shift = viewShift(height, inset);
    camera.setViewOffset(width, height, 0, shift, width, height);
    camera.updateMatrixWorld();
    const { x, y } = new Vector3(0, 0, 0).project(camera);
    const [px, py] = [((x + 1) / 2) * width, ((1 - y) / 2) * height];
    assert.ok(Math.abs(px - width / 2) < 1e-6, "still centred across");
    // Halfway between the shell's bottom edge and the HUD's top edge.
    assert.ok(Math.abs(py - (inset.top + (height - inset.bottom)) / 2) < 1e-6, `y ${py}`);
  });
});

describe("flightDuration", () => {
  test("is longer for a longer trip, within 0.6 to 1.3 seconds", () => {
    assert.ok(flightDuration(2, 0) < flightDuration(15, 20));
    for (const [travel, zoom] of [
      [0, 0],
      [5, 5],
      [100, 100],
    ]) {
      const seconds = flightDuration(travel, zoom);
      assert.ok(seconds >= 0.6 && seconds <= 1.3, `${seconds}`);
    }
  });
});

describe("flights", () => {
  const from = pose(0, 0.45, 0, 30, 0);
  const to = pose(6, 0.5, -3, 12, 118);
  const direction = new Vector3(0, 0.64, 0.77);

  test("starts at the old pose and ends exactly at the new one", () => {
    const flight = createFlight();
    startFlight(flight, from, to, direction);
    let last = false;
    stepFlight(flight, 0, out);
    assert.deepEqual(out, from);
    for (let i = 0; i < 200 && flight.active; i++) last = stepFlight(flight, 1 / 60, out);
    assert.ok(last);
    assert.ok(!flight.active);
    assert.deepEqual(out, to);
  });

  test("moves smoothly one way: no backing up, no overshoot", () => {
    const flight = createFlight();
    startFlight(flight, from, to, direction);
    let previous = from.distance;
    while (flight.active) {
      stepFlight(flight, 1 / 60, out);
      assert.ok(out.distance <= previous + 1e-9 && out.distance >= to.distance - 1e-9);
      assert.ok(out.x >= -1e-9 && out.x <= to.x + 1e-9);
      previous = out.distance;
    }
  });

  test("keeps the camera's angle: the same azimuth and elevation from the target all the way", () => {
    const flight = createFlight();
    startFlight(flight, from, to, direction);
    assert.ok(Math.abs(Math.hypot(flight.dx, flight.dy, flight.dz) - 1) < 1e-12);
    const angles = (p: Pose) => {
      // The camera stands at the target plus the held direction times the distance.
      const [dx, dy, dz] = [flight.dx * p.distance, flight.dy * p.distance, flight.dz * p.distance];
      return [Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz))];
    };
    const [azimuth, elevation] = angles(from);
    while (flight.active) {
      stepFlight(flight, 1 / 30, out);
      const [a, e] = angles(out);
      assert.ok(Math.abs(a - azimuth) < 1e-9 && Math.abs(e - elevation) < 1e-9);
    }
  });

  test("finishes in about its duration, however the frames fall", () => {
    for (const delta of [1 / 144, 1 / 60, 1 / 30]) {
      const flight = createFlight();
      startFlight(flight, from, to, direction);
      let seconds = 0;
      while (flight.active) {
        stepFlight(flight, delta, out);
        seconds += delta;
      }
      assert.ok(Math.abs(seconds - flight.duration) <= delta + 1e-9, `${delta}: ${seconds}`);
    }
  });

  test("doesn't skip ahead after a hitch", () => {
    const flight = createFlight();
    startFlight(flight, from, to, direction);
    stepFlight(flight, 5, out);
    assert.ok(flight.active, "a five second frame is not five seconds of flight");
    assert.ok(out.distance > to.distance);
  });

  test("stops where it is when cancelled, and then writes nothing", () => {
    const flight = createFlight();
    startFlight(flight, from, to, direction);
    stepFlight(flight, 0.2, out);
    const cancelledAt = { ...out };
    cancelFlight(flight);
    out.x = out.distance = -1;
    assert.equal(stepFlight(flight, 1 / 60, out), false);
    assert.equal(out.distance, -1, "the pose is untouched");
    assert.ok(cancelledAt.distance < from.distance && cancelledAt.distance > to.distance);
  });

  test("a repeated request restarts from wherever the camera is, towards the same place", () => {
    const flight = createFlight();
    startFlight(flight, from, to, direction);
    stepFlight(flight, 0.3, out);
    const midway = { ...out };
    startFlight(flight, midway, to, direction);
    assert.ok(flight.active);
    assert.equal(flight.elapsed, 0);
    stepFlight(flight, 0, out);
    assert.deepEqual(out, midway);
    while (flight.active) stepFlight(flight, 1 / 60, out);
    assert.deepEqual(out, to);
  });

  test("a request for where the camera already is ends there without a jump", () => {
    const flight = createFlight();
    startFlight(flight, to, to, direction);
    stepFlight(flight, 1 / 60, out);
    assert.deepEqual(out, to);
  });

  test("snaps to the end for reduced motion", () => {
    const flight = createFlight();
    startFlight(flight, from, to, direction);
    finishFlight(flight, out);
    assert.deepEqual(out, to);
    assert.ok(!flight.active);
  });

  test("looks down on a camera that sits on its target", () => {
    const flight = createFlight();
    startFlight(flight, from, to, new Vector3(0, 0, 0));
    assert.deepEqual([flight.dx, flight.dy, flight.dz], [0, 1, 0]);
  });
});

describe("ease", () => {
  test("runs 0 to 1, slow at both ends", () => {
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
    assert.ok(ease(0.1) < 0.1 && ease(0.9) > 0.9);
    assert.equal(ease(-1), 0);
    assert.equal(ease(2), 1);
  });
});

describe("focus sessions", () => {
  type Request = { id: number; serial: number };
  const request = (id: number, serial: number): Request => ({ id, serial });

  test("keeps a request pending until it has really started, however often it is received", () => {
    const session = createSession<Request>();
    const r = request(4, 1);
    assert.ok(receive(session, r));
    assert.equal(session.pending, r);
    // Effects that run again before the controls or the blob exist take it up again, and change nothing.
    assert.ok(!receive(session, r));
    assert.ok(!receive(session, r));
    assert.equal(session.pending, r, "still waiting to start");
    assert.ok(!session.focused);
    started(session);
    assert.equal(session.pending, null);
    assert.ok(session.focused);
  });

  test("does not start a request twice: a re-render or StrictMode remount after it started", () => {
    const session = createSession<Request>();
    const r = request(4, 1);
    receive(session, r);
    started(session);
    assert.ok(!receive(session, r));
    assert.equal(session.pending, null);
    assert.ok(session.focused);
  });

  test("starts again for the same blob when the request has a new serial", () => {
    const session = createSession<Request>();
    receive(session, request(4, 1));
    started(session);
    assert.ok(receive(session, request(4, 2)));
    assert.equal(session.pending?.serial, 2);
    assert.ok(!session.focused);
  });

  test("replaces a request that never started with the next one", () => {
    const session = createSession<Request>();
    receive(session, request(4, 1));
    receive(session, request(9, 2));
    assert.equal(session.pending?.id, 9);
  });

  test("clears everything for a null request: the selection moved on", () => {
    const session = createSession<Request>();
    receive(session, request(4, 1));
    started(session);
    assert.ok(!receive(session, null));
    assert.deepEqual(session, createSession());
    // And a pending one too.
    receive(session, request(4, 2));
    receive(session, null);
    assert.equal(session.pending, null);
    // The same request object coming back after a null is new to it.
    const r = request(5, 3);
    receive(session, r);
    receive(session, null);
    assert.ok(receive(session, r));
  });

  test("a grab of the controls ends the request, pending or flying", () => {
    const session = createSession<Request>();
    receive(session, request(4, 1));
    takenOver(session);
    assert.equal(session.pending, null);
    receive(session, request(4, 2));
    started(session);
    takenOver(session);
    assert.ok(!session.focused);
  });

  test("a reframe ends the focus but keeps a request that has not started", () => {
    const session = createSession<Request>();
    receive(session, request(4, 1));
    reframed(session);
    assert.equal(session.pending?.id, 4);
    started(session);
    reframed(session);
    assert.ok(!session.focused);
  });

  test("gives up on a request whose blob never mounts, after a few seconds", () => {
    const session = createSession<Request>();
    receive(session, request(999, 1));
    let frames = 0;
    while (keepWaiting(session, 1 / 60)) frames++;
    assert.ok(Math.abs(frames / 60 - GIVE_UP) < 0.05, `${frames} frames`);
    assert.equal(session.pending, null);
    assert.ok(!keepWaiting(session, 1 / 60), "nothing to wait for");
  });
});
