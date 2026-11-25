import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { type BufferGeometry, ExtrudeGeometry, type Group, Shape, ShapeGeometry } from "three";
import { useReducedMotion } from "./blobMedia.ts";
import { box, cylinder, paint, partsBuilder, triangle } from "./harbourGeometry.ts";
import {
  type Heading,
  harbourShores,
  sailAt,
  shoreCalm,
  shoreDistance,
  type Shores,
  waveHeight,
} from "./harbourMotion.ts";
import { useToy } from "./harbourToys.ts";
import { type HarbourBoat, type HarbourLayout, WATER_LEVEL } from "./layoutHarbour.ts";

const HULLS = [
  "#c64b3f",
  "#2f5f8a",
  "#3e8a7e",
  "#e0b045",
  "#f3ede0",
  "#7d4d6b",
  "#5a7d9a",
  "#e07b39",
];
const DECK = "#c8a77c";
const WHITE = "#f7f3ea";
const NAVY = "#24405e";
const SAIL = "#fbf6ea";
const STRIPES = ["#d1493d", "#3a8fa3", "#e3b23c", "#5c9e5a"];
const PANE = "#3f4f60";
const MAST = "#e9e3d6";

const BEAM = { dinghy: 1.3, fishing: 1.9, sail: 1.8 };
const FREEBOARD = { dinghy: 0.55, fishing: 0.85, sail: 0.75 }; // hull height above the water
const DRAUGHT = 0.3; // below it
const LAP_SECONDS = 26;

// Where a boat is this frame; each boat writes all of it before reading, so they share it.
const here: Heading = { x: 0, z: 0, heading: 0 };

// A hull's outline from above: a square-ish stern, full amidships, a pointed bow along +z.
function hullShape(length: number, beam: number): Shape {
  const l = length / 2;
  const b = beam / 2;
  const shape = new Shape();
  // Shape space (x, y) is turned so y becomes -z; draw the bow at y = -l so it ends up at +z.
  shape.moveTo(-b * 0.78, l);
  shape.lineTo(-b, l * 0.1);
  shape.lineTo(-b * 0.72, -l * 0.62);
  shape.lineTo(0, -l);
  shape.lineTo(b * 0.72, -l * 0.62);
  shape.lineTo(b, l * 0.1);
  shape.lineTo(b * 0.78, l);
  shape.closePath();
  return shape;
}

// The hull, its deck and a stripe below the gunwale, standing on the waterline at y = 0.
function hull(boat: HarbourBoat): BufferGeometry[] {
  const beam = BEAM[boat.kind];
  const height = FREEBOARD[boat.kind] + DRAUGHT;
  const colour = HULLS[boat.colour % HULLS.length];
  const shape = hullShape(boat.length, beam);
  const sides = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
    .rotateX(-Math.PI / 2)
    .translate(0, -DRAUGHT, 0);
  const band = new ExtrudeGeometry(hullShape(boat.length + 0.06, beam + 0.06), {
    depth: 0.12,
    bevelEnabled: false,
  })
    .rotateX(-Math.PI / 2)
    .translate(0, FREEBOARD[boat.kind] - 0.22, 0);
  const deck = new ShapeGeometry(hullShape(boat.length - 0.2, beam - 0.2))
    .rotateX(-Math.PI / 2)
    .translate(0, FREEBOARD[boat.kind] - 0.06, 0);
  return [
    paint(sides, colour),
    paint(band, colour === WHITE || boat.kind === "sail" ? NAVY : WHITE),
    paint(deck, DECK),
  ];
}

function boatParts(boat: HarbourBoat): BufferGeometry[] {
  const parts = hull(boat);
  const top = FREEBOARD[boat.kind];
  const l = boat.length / 2;
  if (boat.kind === "dinghy") {
    parts.push(box(BEAM.dinghy - 0.25, 0.08, 0.3, 0, top - 0.2, 0.2, DECK));
    parts.push(box(BEAM.dinghy - 0.35, 0.08, 0.3, 0, top - 0.2, -l * 0.55, DECK));
    // A pair of oars shipped along the thwarts.
    parts.push(
      paint(
        box(0.06, 0.04, 2.2, 0, 0, 0, MAST)
          .rotateY(0.08)
          .translate(0.3, top - 0.08, 0),
        MAST,
      ),
    );
    parts.push(
      paint(
        box(0.06, 0.04, 2.2, 0, 0, 0, MAST)
          .rotateY(-0.08)
          .translate(-0.3, top - 0.08, 0),
        MAST,
      ),
    );
  } else if (boat.kind === "fishing") {
    parts.push(
      box(1.3, 1.2, 1.5, 0, top + 0.6, -l * 0.15, WHITE),
      box(1.45, 0.12, 1.7, 0, top + 1.26, -l * 0.15, HULLS[(boat.colour + 3) % HULLS.length]),
      box(1.1, 0.4, 0.06, 0, top + 0.85, -l * 0.15 + 0.76, PANE),
      cylinder(0.05, 0.06, 2.6, 6, 0, top + 1.3, -l * 0.6, MAST),
      box(1.4, 0.06, 0.06, 0, top + 2.2, -l * 0.6, MAST),
      // Orange buoys hung over the side.
      cylinder(0.14, 0.14, 0.34, 8, BEAM.fishing / 2 + 0.05, top - 0.25, 0.4, "#ef7d3c"),
      cylinder(0.14, 0.14, 0.34, 8, -BEAM.fishing / 2 - 0.05, top - 0.25, -0.5, "#ef7d3c"),
    );
  }
  return parts;
}

// A sailboat's rig, around its mast: the sails are flat triangles drawn from both sides.
function rigParts(boat: HarbourBoat): BufferGeometry[] {
  const top = FREEBOARD.sail;
  const l = boat.length / 2;
  const mastZ = l * 0.22;
  const height = 6.6;
  const stripe = STRIPES[boat.colour % STRIPES.length];
  return [
    box(0.9, 0.45, 1.4, 0, top + 0.2, -l * 0.25, WHITE),
    cylinder(0.06, 0.08, height, 6, 0, top + height / 2, mastZ, MAST),
    paint(
      box(0.06, 0.06, l * 1.05, 0, 0, 0, MAST).translate(0, top + 0.95, mastZ - (l * 1.05) / 2),
      MAST,
    ),
    // The mainsail, aft of the mast, with a coloured band near its foot; and the jib forward.
    triangle(
      [0, top + height - 0.2, mastZ],
      [0, top + 1.0, mastZ],
      [0, top + 1.0, mastZ - l * 1.0],
      SAIL,
    ),
    triangle(
      [0, top + 1.55, mastZ - 0.05],
      [0, top + 1.0, mastZ - 0.05],
      [0, top + 1.0, mastZ - l * 0.92],
      stripe,
    ),
    triangle(
      [0, top + height - 0.6, mastZ + 0.02],
      [0, top + 0.5, l * 0.92],
      [0, top + 0.6, mastZ + 0.05],
      SAIL,
    ),
  ];
}

interface BoatProps {
  boat: HarbourBoat;
  shores: Shores;
  still: boolean;
}

// How a boat rides the swell where it is: bob, pitch and roll from the wave's slope. Allocates
// nothing; writes into the group.
function ride(g: Group, at: Heading, shores: Shores, t: number, heaviness: number) {
  const calm = shoreCalm(shoreDistance(at, shores)) / heaviness;
  const h = waveHeight(at.x, at.z, t);
  const sx = Math.sin(at.heading);
  const cz = Math.cos(at.heading);
  const ahead = waveHeight(at.x + sx, at.z + cz, t) - waveHeight(at.x - sx, at.z - cz, t);
  const beside = waveHeight(at.x + cz, at.z - sx, t) - waveHeight(at.x - cz, at.z + sx, t);
  g.position.set(at.x, WATER_LEVEL + h * calm, at.z);
  g.rotation.set(-ahead * calm * 1.2, at.heading, beside * calm * 1.2, "YXZ");
}

/** A moored boat, riding the swell where it lies. */
function MooredBoat({ boat, shores, still }: BoatProps) {
  const geometry = useMemo(() => {
    const parts = partsBuilder();
    parts.add(boatParts(boat));
    return parts.merge();
  }, [boat]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    here.x = boat.x;
    here.z = boat.z;
    here.heading = boat.heading;
    ride(group.current, here, shores, still ? 0 : clock.elapsedTime, 1);
  });
  return (
    <group ref={group} position={[boat.x, WATER_LEVEL, boat.z]} rotation-y={boat.heading}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshLambertMaterial vertexColors side={2} />
      </mesh>
    </group>
  );
}

/** A sailboat at anchor. Clicked, it sails a lap of the bay and comes back to its mooring. */
function Sailboat({ boat, shores, still }: BoatProps) {
  const toy = useToy(LAP_SECONDS, !still && boat.loop !== undefined, 0.01, false);
  const geometry = useMemo(() => {
    const parts = partsBuilder();
    parts.add([...boatParts(boat), ...rigParts(boat)]);
    return parts.merge();
  }, [boat]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const group = useRef<Group>(null);
  const lap = useMemo(
    () => (boat.loop ? { x: boat.x, z: boat.z, heading: boat.heading, loop: boat.loop } : null),
    [boat],
  );

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const now = clock.elapsedTime;
    const since = toy.since(now);
    if (lap && since < LAP_SECONDS) {
      sailAt(lap, since / LAP_SECONDS, here);
    } else {
      // At anchor she swings a little to the breeze.
      here.x = boat.x;
      here.z = boat.z;
      here.heading = boat.heading + (still ? 0 : Math.sin(now * 0.13 + boat.colour) * 0.15);
    }
    ride(g, here, shores, still ? 0 : now, 1.3);
    // Heeling over while under way.
    if (lap && since < LAP_SECONDS)
      g.rotation.z += 0.16 * Math.sin((Math.PI * since) / LAP_SECONDS);
  });

  return (
    <group
      ref={group}
      position={[boat.x, WATER_LEVEL, boat.z]}
      rotation-y={boat.heading}
      {...toy.handlers}
    >
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshLambertMaterial vertexColors side={2} />
      </mesh>
      {/* Easy to hit: the hull and the sails. */}
      <mesh visible={false} position-y={3.4} scale={[2.2, 7.4, boat.length]}>
        <boxGeometry />
      </mesh>
    </group>
  );
}

/** Boats in the bay: dinghies and fishing boats moored at the pier, and sailboats at anchor. */
export function HarbourBoats({ harbour }: { harbour: HarbourLayout }) {
  const still = useReducedMotion();
  const shores = useMemo(() => harbourShores(harbour), [harbour]);
  return (
    <group>
      {harbour.boats.map((boat, i) =>
        boat.kind === "sail" ? (
          <Sailboat key={i} boat={boat} shores={shores} still={still} />
        ) : (
          <MooredBoat key={i} boat={boat} shores={shores} still={still} />
        ),
      )}
    </group>
  );
}
