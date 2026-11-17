import { MathUtils, type Vector3Tuple } from "three";
import { ADULT_HEIGHT, BLOB_GEOMETRY, type Shape } from "./blobGeometry.ts";
import { blobScale } from "./blobSize.ts";

// How the inspector's portrait frames one blob. Pure maths, so the tests can check the crop.

/** A narrow field of view from further back flattens the blob less than a close lens would. */
export const PORTRAIT_FOV = 24;

/** The camera sits this far above the blob's middle, looking slightly down on its face. */
export const PORTRAIT_ELEVATION = MathUtils.degToRad(14);

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
  // The camera looks down, so depth adds to the height it sees, and the nearest part of the blob is
  // closer to the lens than its middle.
  const above = Math.max(height - targetY, targetY);
  const visibleHalfHeight =
    above * Math.cos(PORTRAIT_ELEVATION) + halfDepth * Math.sin(PORTRAIT_ELEVATION);
  const tan = Math.tan(MathUtils.degToRad(PORTRAIT_FOV / 2));
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const distance =
    PADDING * Math.max(visibleHalfHeight / tan, halfWidth / (tan * safeAspect)) + halfDepth;

  return {
    target: [0, targetY, 0],
    position: [
      0,
      targetY + distance * Math.sin(PORTRAIT_ELEVATION),
      distance * Math.cos(PORTRAIT_ELEVATION),
    ],
  };
}
