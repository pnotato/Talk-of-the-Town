import type { Shape } from "./blobGeometry.ts";
import type { Mood } from "./blobMood.ts";
import type { Pose } from "./blobMotion.ts";

// Looping scenes for the Shapes sandbox, to show moods, poses, talking and walking in action. Each
// beat sets every actor's mood (which also sets its colour), pose and whether it is talking; the
// blobs ease from one beat to the next.

/** One actor's part in a beat. `x` and `yaw` move the actor away from its spot, e.g. to walk. */
export type ActorBeat = { mood: Mood; pose?: Pose; talking?: boolean; x?: number; yaw?: number };

export type Beat = { seconds: number; actors: ActorBeat[] };

/** An actor's spot (x from the scene's centre) and facing (radians about y; 0 faces the camera). */
export type Actor = { shape: Shape; age: number; x: number; yaw: number };

export type Scenario = { title: string; detail: string; actors: Actor[]; beats: Beat[] };

// A pair stand a little apart and turn this far towards each other.
const PAIR_X = 0.7;
const PAIR_TURN = 0.4;

const pair = (left: Shape, right: Shape): Actor[] => [
  { shape: left, age: 35, x: -PAIR_X, yaw: PAIR_TURN },
  { shape: right, age: 35, x: PAIR_X, yaw: -PAIR_TURN },
];

export const SCENARIOS: Scenario[] = [
  {
    title: "Talking",
    detail: "one tells, one reacts",
    actors: pair("triangle", "circle"),
    beats: [
      { seconds: 1.6, actors: [{ mood: "smile", talking: true, pose: "lean" }, { mood: "flat" }] },
      {
        seconds: 1.6,
        actors: [
          { mood: "o", talking: true, pose: "bounce" },
          { mood: "o", pose: "recoil" },
        ],
      },
      {
        seconds: 1.8,
        actors: [
          { mood: "smile", talking: true, pose: "lean" },
          { mood: "worried", pose: "tremble" },
        ],
      },
      { seconds: 1.6, actors: [{ mood: "smile" }, { mood: "frown", pose: "slump" }] },
      { seconds: 1.2, actors: [{ mood: "smile" }, { mood: "flat" }] },
    ],
  },
  {
    title: "Arguing",
    detail: "both dig in",
    actors: pair("square", "star"),
    beats: [
      { seconds: 1.4, actors: [{ mood: "flat", talking: true, pose: "lean" }, { mood: "flat" }] },
      { seconds: 1.4, actors: [{ mood: "frown" }, { mood: "frown", talking: true, pose: "lean" }] },
      {
        seconds: 1.4,
        actors: [
          { mood: "angry", talking: true, pose: "shake" },
          { mood: "frown", pose: "recoil" },
        ],
      },
      {
        seconds: 1.4,
        actors: [
          { mood: "angry", pose: "recoil" },
          { mood: "angry", talking: true, pose: "shake" },
        ],
      },
      {
        seconds: 1.8,
        actors: [
          { mood: "angry", talking: true, pose: "shake" },
          { mood: "angry", talking: true, pose: "shake" },
        ],
      },
      {
        seconds: 1.6,
        actors: [
          { mood: "frown", pose: "slump" },
          { mood: "frown", pose: "slump" },
        ],
      },
      { seconds: 1, actors: [{ mood: "flat" }, { mood: "flat" }] },
    ],
  },
  {
    title: "Posting",
    detail: "on the phone, to social media",
    actors: [{ shape: "capsule", age: 35, x: 0, yaw: 0 }],
    beats: [
      { seconds: 2, actors: [{ mood: "flat", pose: "phone" }] },
      { seconds: 1.4, actors: [{ mood: "o", pose: "phone" }] },
      { seconds: 2, actors: [{ mood: "smile", pose: "phone" }] },
      { seconds: 1.2, actors: [{ mood: "smile" }] },
    ],
  },
  {
    title: "Walking",
    detail: "hops with squash and stretch",
    actors: [{ shape: "tear", age: 35, x: -1, yaw: 0 }],
    // Starts with a pause at its spot: a blob appears where its first beat puts it.
    beats: [
      { seconds: 0.8, actors: [{ mood: "smile", x: -1, yaw: 0 }] },
      { seconds: 2.4, actors: [{ mood: "smile", x: 1, yaw: 1.2 }] },
      { seconds: 0.8, actors: [{ mood: "smile", x: 1, yaw: 0 }] },
      { seconds: 2.4, actors: [{ mood: "smile", x: -1, yaw: -1.2 }] },
    ],
  },
];

/** How far a scenario's actors reach either side of its centre, at most. */
export function scenarioHalfWidth({ actors, beats }: Scenario) {
  const xs = [...actors.map((a) => a.x), ...beats.flatMap((b) => b.actors.map((a) => a.x ?? 0))];
  return Math.max(...xs.map(Math.abs));
}
