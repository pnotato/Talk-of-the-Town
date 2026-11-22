import { MathUtils, type Vector3Tuple } from "three";
import { ADULT_HEIGHT, BLOB_GEOMETRY, type Shape } from "./blobGeometry.ts";
import { blobScale } from "./blobSize.ts";

// How the inspector's portrait frames one blob. Pure maths, so the tests can check the crop.

/** A narrow field of view from further back flattens the blob less than a close lens would. */
export const PORTRAIT_FOV = 24;

/** A slightly low, left-hand viewpoint makes the face look screen-right and upward. */
export const PORTRAIT_ELEVATION = MathUtils.degToRad(-8);
export const PORTRAIT_AZIMUTH = MathUtils.degToRad(-14);

// Room left around the biggest blob (an elder), so its shadowless outline never touches the edge.
const PADDING = 1.14;

// Height of the aim point as a share of the blob's height; just above the middle, near the eyes.
const AIM = 0.54;

// The biggest an age group gets: portraits are all framed for this size, so a child really does look
// smaller than an adult and an elder stockier, as in the town.
const BIGGEST_AGE = 65;

/**
 * Where the camera stands and what it looks at, for a canvas of the given width over height. The
 * blob faces +z and stands on the origin. The frame fits the largest size the shape comes in,
 * whatever the age, so changing age changes the blob on screen rather than the zoom.
 */
export function portraitFraming(
  shape: Shape,
  aspect: number,
): { position: Vector3Tuple; target: Vector3Tuple } {
  const [sx, sy, sz] = blobScale(BIGGEST_AGE);
  const { max } = BLOB_GEOMETRY[shape].boundingBox!;
  const height = ADULT_HEIGHT[shape] * sy;
  const halfWidth = max.x * sx;
  const halfDepth = max.z * sz;

  const targetY = height * AIM;
  const sinYaw = Math.sin(PORTRAIT_AZIMUTH);
  const cosYaw = Math.cos(PORTRAIT_AZIMUTH);
  const sinPitch = Math.sin(PORTRAIT_ELEVATION);
  const cosPitch = Math.cos(PORTRAIT_ELEVATION);
  const tan = Math.tan(MathUtils.degToRad(PORTRAIT_FOV / 2));
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;

  // Fit each bounding-box corner in camera space. Combining independent worst-case width and
  // depth would zoom out unnecessarily when the portrait is turned.
  let distance = 0;
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-targetY, height - targetY]) {
      for (const z of [-halfDepth, halfDepth]) {
        const across = x * cosYaw - z * sinYaw;
        const depth = x * sinYaw + z * cosYaw;
        const up = y * cosPitch - depth * sinPitch;
        const toward = depth * cosPitch + y * sinPitch;
        distance = Math.max(
          distance,
          toward + PADDING * Math.max(Math.abs(up) / tan, Math.abs(across) / (tan * safeAspect)),
        );
      }
    }
  }

  return {
    target: [0, targetY, 0],
    position: [
      distance * cosPitch * Math.sin(PORTRAIT_AZIMUTH),
      targetY + distance * Math.sin(PORTRAIT_ELEVATION),
      distance * cosPitch * cosYaw,
    ],
  };
}
