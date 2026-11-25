// Low-poly building blocks for the harbour's props: painted boxes, cylinders and roofs that are
// placed and merged into one geometry per kind of thing, so a whole street draws in one call.
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Non-indexed, with one colour per vertex and only positions, normals and colours. */
export function paint(geometry: BufferGeometry, hex: string): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const c = new Color(hex);
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "color") g.deleteAttribute(name);
  }
  return g;
}

export const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hex: string,
) => paint(new BoxGeometry(w, h, d).translate(x, y, z), hex);

export const cylinder = (
  top: number,
  bottom: number,
  h: number,
  segments: number,
  x: number,
  y: number,
  z: number,
  hex: string,
) => paint(new CylinderGeometry(top, bottom, h, segments).translate(x, y, z), hex);

/** A flat triangle, seen from both sides when drawn double-sided. */
export function triangle(a: number[], b: number[], c: number[], hex: string): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([...a, ...b, ...c], 3));
  g.computeVertexNormals();
  return paint(g, hex);
}

/**
 * A gable roof sitting on y = 0: two slopes meeting at a ridge `height` up, running along x
 * (`width` long) over a `depth` span, with its two triangular ends painted like the walls.
 */
export function gable(
  width: number,
  depth: number,
  height: number,
  roofHex: string,
  endHex: string,
): BufferGeometry {
  const w = width / 2;
  const d = depth / 2;
  const h = height;
  const slopes = new BufferGeometry();
  // Front-facing triangles wind anticlockwise seen from outside.
  // prettier-ignore
  slopes.setAttribute("position", new Float32BufferAttribute([
    -w, 0, d, w, 0, d, w, h, 0, -w, 0, d, w, h, 0, -w, h, 0, // the front slope
    w, 0, -d, -w, 0, -d, -w, h, 0, w, 0, -d, -w, h, 0, w, h, 0, // the back slope
  ], 3));
  slopes.computeVertexNormals();
  const ends = new BufferGeometry();
  // prettier-ignore
  ends.setAttribute("position", new Float32BufferAttribute([
    w, 0, d, w, 0, -d, w, h, 0,
    -w, 0, -d, -w, 0, d, -w, h, 0,
  ], 3));
  ends.computeVertexNormals();
  const merged = mergeGeometries([paint(slopes, roofHex), paint(ends, endHex)]);
  return merged;
}

/** Collects painted parts, each placed by a turn and a move, and merges them into one geometry. */
export function partsBuilder() {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  const at = new Vector3();
  return {
    /** Adds `pieces`, built in their own space, turned by rotationY and moved to (x, y, z). */
    add(pieces: BufferGeometry[], x = 0, y = 0, z = 0, rotationY = 0) {
      matrix.compose(at.set(x, y, z), turn.setFromAxisAngle(up, rotationY), one);
      for (const piece of pieces) parts.push(piece.applyMatrix4(matrix));
    },
    /** One geometry of everything added; the pieces are disposed. */
    merge(): BufferGeometry {
      if (parts.length === 0) return new BufferGeometry();
      const merged = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      parts.length = 0;
      return merged;
    },
  };
}
