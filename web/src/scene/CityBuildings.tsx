import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CURB } from "./CityGround.tsx";
import { type Placement, UNIT_BOX, useInstances } from "./cityInstances.ts";
import { type CityBuilding, type CityLayout, SETBACK } from "./layoutCity.ts";
import { seededRandom } from "./mapLayout.ts";

const WINDOW_PITCH = 2; // one window every 2 units along a wall
const FLOOR = 2.4;
const CELLS = 8; // the window texture is 8 x 8 windows, so patterns repeat rarely
const CELL_PX = 64;

const FACADES = {
  apartments: ["#c98e6f", "#b9775c", "#d6b48c", "#a86f5a", "#cfa07a", "#bf8a6b"],
  offices: ["#9fb0c0", "#8a9bab", "#b7c2cc", "#7f8fa0", "#a7b5c4", "#95a7b5"],
  shops: ["#e4cfa8", "#d9b8a0", "#c7d3b5", "#e8dcc5", "#d8c4d6"],
} as const;
const ROOF_SHADE = 0.72;
// Canopies over apartment doors take their district's colour, a second cue after the blocks.
const DISTRICT = [
  "#d1495b",
  "#2e86ab",
  "#e9a03b",
  "#5b8e7d",
  "#8e6c8a",
  "#c9a227",
  "#457b9d",
  "#bc6c25",
];
const AWNINGS = ["#d1495b", "#2a9d8f", "#e9c46a", "#457b9d", "#f4a261"];
const DOOR = "#4b3326";

// Same hash for a building index every time, so colours and patterns never shuffle.
function hash(i: number, salt: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  return (h ^ (h >>> 15)) >>> 0;
}

// Wall-and-glass tiles (map) plus the warm glow of a few lit windows (emissiveMap).
function windowTextures(): { walls: CanvasTexture; lights: CanvasTexture } {
  const size = CELLS * CELL_PX;
  const draw = (
    paint: (g: CanvasRenderingContext2D, x: number, y: number, lit: boolean) => void,
  ) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const g = canvas.getContext("2d") as CanvasRenderingContext2D;
    const random = seededRandom(7);
    for (let row = 0; row < CELLS; row++) {
      for (let col = 0; col < CELLS; col++) paint(g, col * CELL_PX, row * CELL_PX, random() < 0.2);
    }
    const texture = new CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  const pane = (g: CanvasRenderingContext2D, x: number, y: number) =>
    g.fillRect(x + 14, y + 12, CELL_PX - 28, CELL_PX - 24);
  return {
    walls: draw((g, x, y, lit) => {
      g.fillStyle = "#ffffff";
      g.fillRect(x, y, CELL_PX, CELL_PX);
      g.fillStyle = lit ? "#a49a86" : "#5a6068";
      pane(g, x, y);
    }),
    lights: draw((g, x, y, lit) => {
      g.fillStyle = "#000000";
      g.fillRect(x, y, CELL_PX, CELL_PX);
      if (!lit) return;
      g.fillStyle = "#ffcf87";
      pane(g, x, y);
    }),
  };
}

// Every building's podium and tower in one mesh. Walls get window UVs counted in whole
// windows centred on each wall; roofs sample the plain wall at the corner of a tile.
function buildingGeometry(buildings: CityBuilding[]): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const wall = new Color();
  const roof = new Color();
  buildings.forEach((b, i) => {
    const palette = FACADES[b.kind];
    wall.set(palette[hash(i, 1) % palette.length]);
    roof.copy(wall).multiplyScalar(ROOF_SHADE);
    const offsetU = (hash(i, 2) % CELLS) / CELLS;
    const offsetV = (hash(i, 3) % CELLS) / CELLS;
    const tiers =
      b.podium < b.height
        ? [
            { w: b.width, d: b.depth, y0: 0, y1: b.podium },
            { w: b.width - 2 * SETBACK, d: b.depth - 2 * SETBACK, y0: b.podium, y1: b.height },
          ]
        : [{ w: b.width, d: b.depth, y0: 0, y1: b.height }];
    for (const { w, d, y0, y1 } of tiers) {
      const box = new BoxGeometry(w, y1 - y0, d).translate(b.x, CURB + (y0 + y1) / 2, b.z);
      const position = box.getAttribute("position");
      const normal = box.getAttribute("normal");
      const uv = box.getAttribute("uv");
      const colors: number[] = [];
      for (let v = 0; v < position.count; v++) {
        const up = Math.abs(normal.getY(v)) > 0.5;
        const c = up ? roof : wall;
        colors.push(c.r, c.g, c.b);
        if (up) {
          uv.setXY(v, 0.1 / CELLS, 0.1 / CELLS);
          continue;
        }
        const sideways = Math.abs(normal.getX(v)) > 0.5;
        const length = sideways ? d : w;
        const start = sideways ? b.z - d / 2 : b.x - w / 2;
        const spare = length - Math.floor(length / WINDOW_PITCH) * WINDOW_PITCH;
        const along = (sideways ? position.getZ(v) : position.getX(v)) - start - spare / 2;
        uv.setXY(
          v,
          along / WINDOW_PITCH / CELLS + offsetU,
          (position.getY(v) - CURB) / FLOOR / CELLS + offsetV,
        );
      }
      box.setAttribute("color", new Float32BufferAttribute(colors, 3));
      parts.push(box);
    }
  });
  return mergeGeometries(parts);
}

const TANK = new CylinderGeometry(0.5, 0.5, 1, 12).translate(0, 0.5, 0);

/** Towers, offices and shops with window detail, apartment doors, roof plant and awnings. */
export function CityBuildings({ city }: { city: CityLayout }) {
  const geometry = useMemo(() => buildingGeometry(city.buildings), [city.buildings]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const textures = useMemo(() => windowTextures(), []);
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures]);

  const placements = useMemo(() => {
    const doors: Placement[] = [];
    const canopies: Placement[] = [];
    for (const h of city.homes) {
      const out = { x: Math.sin(h.facing), z: Math.cos(h.facing) };
      doors.push({
        x: h.door.x + out.x * 0.06,
        y: CURB + 1.05,
        z: h.door.z + out.z * 0.06,
        rotationY: h.facing,
        sx: 1.1,
        sy: 2.1,
        sz: 0.12,
      });
      canopies.push({
        x: h.door.x + out.x * 0.5,
        y: CURB + 2.45,
        z: h.door.z + out.z * 0.5,
        rotationY: h.facing,
        sx: 1.7,
        sy: 0.14,
        sz: 1,
        color: DISTRICT[h.neighbourhood % DISTRICT.length],
      });
    }

    const plant: Placement[] = [];
    const tanks: Placement[] = [];
    const awnings: Placement[] = [];
    city.buildings.forEach((b, i) => {
      const top = CURB + b.height;
      const inset = b.podium < b.height ? SETBACK : 0;
      const roomX = b.width / 2 - inset - 1.8;
      const roomZ = b.depth / 2 - inset - 1.8;
      const at = (salt: number, room: number) => ((hash(i, salt) % 1000) / 500 - 1) * room;
      plant.push({
        x: b.x + at(4, roomX),
        y: top + 0.6,
        z: b.z + at(5, roomZ),
        rotationY: 0,
        sx: 2.4,
        sy: 1.2,
        sz: 1.8,
      });
      if (b.kind === "apartments") {
        tanks.push({
          x: b.x - at(4, roomX),
          y: top,
          z: b.z - at(5, roomZ),
          rotationY: 0,
          sx: 1.8,
          sy: 1.8,
          sz: 1.8,
        });
      }
      if (b.kind === "shops") {
        // Over the shopfront on the street side the default camera sees.
        awnings.push({
          x: b.x,
          y: CURB + 3,
          z: b.z + b.depth / 2 + 0.7,
          rotationY: 0,
          sx: b.width * 0.8,
          sy: 0.2,
          sz: 1.4,
          color: AWNINGS[hash(i, 6) % AWNINGS.length],
        });
      }
    });
    return { doors, canopies, plant, tanks, awnings };
  }, [city.homes, city.buildings]);

  const doors = useInstances(placements.doors);
  const canopies = useInstances(placements.canopies);
  const plant = useInstances(placements.plant);
  const tanks = useInstances(placements.tanks);
  const awnings = useInstances(placements.awnings);

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshLambertMaterial
          vertexColors
          map={textures.walls}
          emissiveMap={textures.lights}
          emissive="#ffffff"
          emissiveIntensity={0.5}
        />
      </mesh>
      <instancedMesh
        ref={doors}
        args={[UNIT_BOX, undefined, placements.doors.length]}
        receiveShadow
      >
        <meshLambertMaterial color={DOOR} />
      </instancedMesh>
      <instancedMesh
        ref={canopies}
        args={[UNIT_BOX, undefined, placements.canopies.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={plant}
        args={[UNIT_BOX, undefined, placements.plant.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial color="#8d939a" />
      </instancedMesh>
      <instancedMesh ref={tanks} args={[TANK, undefined, placements.tanks.length]} castShadow>
        <meshLambertMaterial color="#8a6a4f" />
      </instancedMesh>
      <instancedMesh
        ref={awnings}
        args={[UNIT_BOX, undefined, placements.awnings.length]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  );
}
