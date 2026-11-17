import type { Shape } from "./blobGeometry.ts";

/** Hand-written blobs for the Shapes sandbox: every shape as a child, an adult and an elder. */
export const shapesFixture: { id: number; shape: Shape; age: number }[] = [
  { id: 1, shape: "square", age: 8 },
  { id: 2, shape: "square", age: 35 },
  { id: 3, shape: "square", age: 75 },
  { id: 4, shape: "circle", age: 8 },
  { id: 5, shape: "circle", age: 35 },
  { id: 6, shape: "circle", age: 75 },
  { id: 7, shape: "triangle", age: 8 },
  { id: 8, shape: "triangle", age: 35 },
  { id: 9, shape: "triangle", age: 75 },
  { id: 10, shape: "star", age: 8 },
  { id: 11, shape: "star", age: 35 },
  { id: 12, shape: "star", age: 75 },
  { id: 13, shape: "tear", age: 8 },
  { id: 14, shape: "tear", age: 35 },
  { id: 15, shape: "tear", age: 75 },
  { id: 16, shape: "capsule", age: 8 },
  { id: 17, shape: "capsule", age: 35 },
  { id: 18, shape: "capsule", age: 75 },
];
