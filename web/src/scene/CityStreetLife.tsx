import { useEffect, useMemo } from "react";
import { BoxGeometry, type BufferGeometry, CylinderGeometry } from "three";
import { type Placement, UNIT_BOX, useInstances } from "./cityInstances.ts";
import { CURB } from "./CityGround.tsx";
import {
  type CityFurniture,
  type CityLayout,
  VEHICLE_LENGTH,
  VEHICLE_WIDTH,
} from "./layoutCity.ts";

const LAMP_HEIGHT = 4.4;

const PAINT = {
  taxi: "#f2c230",
  car: ["#c8553d", "#4f6d7a", "#e6e1d6", "#3d5a40", "#7a6c8f"],
  van: "#eef0f2",
};
const KIOSKS = ["#2a9d8f", "#d1495b"];

// Built once and shared, each at a size of 1 so instances scale them.
function shapes(): Record<string, BufferGeometry> {
  return {
    pole: new CylinderGeometry(0.06, 0.09, LAMP_HEIGHT, 8).translate(0, LAMP_HEIGHT / 2, 0),
    lampHead: new BoxGeometry(0.5, 0.18, 0.5).translate(0, LAMP_HEIGHT, 0),
  };
}

const at = (
  f: CityFurniture,
  y: number,
  sx: number,
  sy: number,
  sz: number,
  color?: string,
): Placement => ({
  x: f.x,
  y,
  z: f.z,
  rotationY: f.rotationY,
  sx,
  sy,
  sz,
  color,
});

/** Lamps, parked cars and taxis, and the plaza's kiosks. */
export function CityStreetLife({ city }: { city: CityLayout }) {
  const geometry = useMemo(() => shapes(), []);
  useEffect(() => () => Object.values(geometry).forEach((g) => g.dispose()), [geometry]);

  const placements = useMemo(() => {
    const lamps = city.lamps.map((l) => ({
      x: l.x,
      y: CURB,
      z: l.z,
      rotationY: 0,
      sx: 1,
      sy: 1,
      sz: 1,
    }));
    const bodies: Placement[] = [];
    const cabins: Placement[] = [];
    const signs: Placement[] = [];
    city.vehicles.forEach((v, i) => {
      const color =
        v.kind === "taxi"
          ? PAINT.taxi
          : v.kind === "van"
            ? PAINT.van
            : PAINT.car[i % PAINT.car.length];
      const tall = v.kind === "van" ? 1.5 : 1;
      bodies.push({
        x: v.x,
        y: 0.55,
        z: v.z,
        rotationY: v.rotationY,
        sx: VEHICLE_WIDTH,
        sy: 0.75,
        sz: VEHICLE_LENGTH,
        color,
      });
      // The cabin sits back of centre; a van's runs nearly the whole length.
      const back = v.kind === "van" ? -0.3 : -0.25;
      const ox = Math.sin(v.rotationY) * back;
      const oz = Math.cos(v.rotationY) * back;
      const cabinLength = v.kind === "van" ? VEHICLE_LENGTH * 0.8 : VEHICLE_LENGTH * 0.5;
      cabins.push({
        x: v.x + ox,
        y: 0.92 + (0.55 * tall) / 2,
        z: v.z + oz,
        rotationY: v.rotationY,
        sx: VEHICLE_WIDTH * 0.86,
        sy: 0.55 * tall,
        sz: cabinLength,
        color,
      });
      if (v.kind === "taxi") {
        signs.push({
          x: v.x + ox,
          y: 0.92 + 0.55 + 0.12,
          z: v.z + oz,
          rotationY: v.rotationY,
          sx: 0.7,
          sy: 0.22,
          sz: 0.3,
        });
      }
    });

    const kiosks: Placement[] = [];
    const roofs: Placement[] = [];
    for (const f of city.furniture) {
      if (f.kind === "kiosk") {
        kiosks.push(
          at(
            f,
            CURB + f.height / 2,
            f.width,
            f.height,
            f.depth,
            KIOSKS[kiosks.length % KIOSKS.length],
          ),
        );
        roofs.push(at(f, CURB + f.height + 0.12, f.width + 0.8, 0.24, f.depth + 0.8));
      }
    }
    return { lamps, bodies, cabins, signs, kiosks, roofs };
  }, [city.lamps, city.vehicles, city.furniture]);

  const polesRef = useInstances(placements.lamps);
  const headsRef = useInstances(placements.lamps);
  const bodiesRef = useInstances(placements.bodies);
  const cabinsRef = useInstances(placements.cabins);
  const signsRef = useInstances(placements.signs);
  const kiosksRef = useInstances(placements.kiosks);
  const roofsRef = useInstances(placements.roofs);
  const count = (list: Placement[]) => list.length;

  return (
    <group>
      <instancedMesh
        ref={polesRef}
        args={[geometry.pole, undefined, count(placements.lamps)]}
        castShadow
      >
        <meshLambertMaterial color="#3b4048" />
      </instancedMesh>
      <instancedMesh ref={headsRef} args={[geometry.lampHead, undefined, count(placements.lamps)]}>
        <meshLambertMaterial color="#fff1c9" emissive="#ffd88a" emissiveIntensity={0.8} />
      </instancedMesh>
      <instancedMesh
        ref={bodiesRef}
        args={[UNIT_BOX, undefined, count(placements.bodies)]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={cabinsRef}
        args={[UNIT_BOX, undefined, count(placements.cabins)]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={signsRef} args={[UNIT_BOX, undefined, count(placements.signs)]}>
        <meshLambertMaterial color="#fff8e1" emissive="#fff3c4" emissiveIntensity={0.6} />
      </instancedMesh>
      <instancedMesh
        ref={kiosksRef}
        args={[UNIT_BOX, undefined, count(placements.kiosks)]}
        castShadow
        receiveShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={roofsRef}
        args={[UNIT_BOX, undefined, count(placements.roofs)]}
        castShadow
      >
        <meshLambertMaterial color="#f4efe6" />
      </instancedMesh>
    </group>
  );
}
