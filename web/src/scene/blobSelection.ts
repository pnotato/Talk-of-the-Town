import { type BufferGeometry, RingGeometry } from "three";
import { BLOB_GEOMETRY, type Shape } from "./blobGeometry.ts";
import { type AgeGroup, ageGroup, blobScale } from "./blobSize.ts";

// The ring on the ground around the selected blob. Pure data and shared geometry, so the scene and
// the tests share it.

// Clear ground between the blob's footprint and the ring, and how thick the ring is.
const GAP = 0.06;
const WIDTH = 0.09;
// The dark outline sticks out this far either side of the bright ring, so it reads on any ground.
const OUTLINE = 0.04;

/** Radius of the footprint circle around a blob: its widest reach on the ground, at its size. */
export function footprintRadius(shape: Shape, age: number) {
  const { max } = BLOB_GEOMETRY[shape].boundingBox!;
  const [sx, , sz] = blobScale(age);
  return Math.max(max.x * sx, max.z * sz);
}

export type RingGeometries = { ring: BufferGeometry; outline: BufferGeometry };

const rings = new Map<string, RingGeometries>();

const flat = (inner: number, outer: number) =>
  new RingGeometry(inner, outer, 64).rotateX(-Math.PI / 2);

/**
 * The selection ring's geometries for a shape and age group, built once and shared by every
 * blob. They are passed to meshes as props, so nothing disposes them with a blob.
 */
export function ringGeometries(shape: Shape, age: number): RingGeometries {
  const group: AgeGroup = ageGroup(age);
  const key = `${shape}:${group}`;
  let geometries = rings.get(key);
  if (!geometries) {
    // Sized from the group's scale, not the exact age, so the cache stays small.
    const inner = footprintRadius(shape, age) + GAP;
    geometries = {
      ring: flat(inner, inner + WIDTH),
      outline: flat(inner - OUTLINE, inner + WIDTH + OUTLINE),
    };
    rings.set(key, geometries);
  }
  return geometries;
}
