import { Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import {
  BoxGeometry,
  Color,
  type Group,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Vector3Tuple,
} from "three";
import { PHONE_SPOT } from "./blobFaceGeometry.ts";
import BlobFace from "./BlobFace.tsx";
import { ADULT_HEIGHT, BASE_EXTENT, BLOB_GEOMETRY, type Shape } from "./blobGeometry.ts";
import { useReducedMotion } from "./blobMedia.ts";
import { MOOD_COLOR, MOODS, type Mood } from "./blobMood.ts";
import {
  animate,
  createAnimation,
  createMotion,
  ease,
  mouthOpen,
  phaseFor,
  type Pose,
} from "./blobMotion.ts";
import { blobScale } from "./blobSize.ts";

// Mood colours as three.js colours, for easing a body towards its mood without allocating.
const MOOD_COLOR3 = Object.fromEntries(MOODS.map((m) => [m, new Color(MOOD_COLOR[m])])) as Record<
  Mood,
  Color
>;

const INK = "#1d2a33";

// Shared by every speech bubble: a flat white oval with "..." on it, tinted when angry.
const BUBBLE = new SphereGeometry(1, 24, 12).scale(0.32, 0.21, 0.04);
const BUBBLE_DOT = new SphereGeometry(0.03, 12, 6);
const BUBBLE_MATERIAL = new MeshStandardMaterial({ color: "#ffffff" });
const ANGRY_BUBBLE_MATERIAL = new MeshStandardMaterial({ color: "#f2c9c4" });
const BUBBLE_DOT_MATERIAL = new MeshStandardMaterial({ color: INK });

function SpeechBubble({ height, angry }: { height: number; angry: boolean }) {
  return (
    <Billboard position={[0, height, 0]}>
      <mesh geometry={BUBBLE} material={angry ? ANGRY_BUBBLE_MATERIAL : BUBBLE_MATERIAL} />
      {[-0.1, 0, 0.1].map((x) => (
        <mesh
          key={x}
          geometry={BUBBLE_DOT}
          material={BUBBLE_DOT_MATERIAL}
          position={[x, 0, 0.04]}
        />
      ))}
    </Billboard>
  );
}

// Shared by every phone: a dark slab with a lit screen.
const PHONE = new BoxGeometry(0.2, 0.3, 0.03);
const SCREEN = new PlaneGeometry(0.16, 0.25).translate(0, 0, 0.016);
const PHONE_MATERIAL = new MeshStandardMaterial({ color: INK });
const SCREEN_MATERIAL = new MeshBasicMaterial({ color: "#9fe3ff" });

// Held below the face, lying nearly flat with the screen tipped up towards the face, so it reads
// from the raised camera.
function Phone({ shape }: { shape: Shape }) {
  return (
    <group position={PHONE_SPOT[shape]} rotation-x={-1.83}>
      <mesh geometry={PHONE} material={PHONE_MATERIAL} />
      <mesh geometry={SCREEN} material={SCREEN_MATERIAL} />
    </group>
  );
}

// Walks and turns ease towards their targets at this rate per second, in two stages (target →
// goal → body), so a walk starts gently instead of at full speed.
const WALK_RATE = 3;
// Body colour eases to a new mood at this rate per second.
const COLOUR_RATE = 4;

type BlobProps = {
  /** Seeds the animation phase, so neighbours don't move in lockstep. */
  id: number;
  shape: Shape;
  age: number;
  mood?: Mood;
  pose?: Pose;
  talking?: boolean;
  /** Play the mood's idle loop while not posing or walking. */
  idle?: boolean;
  /** Where the blob stands. When it changes, the blob walks there. */
  position: Vector3Tuple;
  /** Which way the blob faces, in radians about y; 0 faces +z. */
  yaw?: number;
};

/**
 * One blob: its shape is its culture, its size is its age (docs/BLOBS.md), and its face and body
 * colour show its mood. Props are targets; every frame eases the blob towards them by mutating
 * refs. With reduced motion, faces and colours still change and moves snap instead of easing.
 */
export default function Blob({
  id,
  shape,
  age,
  mood = "smile",
  pose = "idle",
  talking = false,
  idle = false,
  position,
  yaw = 0,
}: BlobProps) {
  const reduceMotion = useReducedMotion();
  // Where and how the blob first appears; after that, props are only targets.
  const [start] = useState(() => ({ position, yaw, color: MOOD_COLOR[mood] }));
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const mouth = useRef<Mesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const goal = useRef({ x: position[0], z: position[2] });
  const animation = useRef(createAnimation(mood));
  const motion = useRef(createMotion());
  const scale = blobScale(age);

  useFrame(({ clock }, delta) => {
    if (!root.current || !body.current || !mouth.current || !material.current) return;
    const t = clock.elapsedTime + phaseFor(id);

    // Walk towards the target position and turn towards the target yaw.
    const r = root.current;
    const g = goal.current;
    g.x = ease(g.x, position[0], WALK_RATE, delta, reduceMotion);
    g.z = ease(g.z, position[2], WALK_RATE, delta, reduceMotion);
    const x = r.position.x;
    const z = r.position.z;
    r.position.x = ease(x, g.x, WALK_RATE, delta, reduceMotion);
    r.position.z = ease(z, g.z, WALK_RATE, delta, reduceMotion);
    const speed = delta > 0 ? Math.hypot(r.position.x - x, r.position.z - z) / delta : 0;
    const turn = Math.atan2(Math.sin(yaw - r.rotation.y), Math.cos(yaw - r.rotation.y));
    r.rotation.y += turn - ease(turn, 0, WALK_RATE, delta, reduceMotion);

    const a = animation.current;
    a.mood = mood;
    a.pose = pose;
    a.idle = idle;
    a.talking = talking;
    a.reduceMotion = reduceMotion;
    const m = animate(a, t, delta, speed, BASE_EXTENT[shape], motion.current);
    body.current.position.y = m.y;
    body.current.rotation.set(m.rx, m.ry, m.rz);
    body.current.scale.set(m.sx, m.sy, m.sx);

    const open = mouthOpen(a, t);
    mouth.current.scale.set(1 - 0.2 * open, 1 + open, 1);

    const blend = reduceMotion ? 1 : 1 - Math.exp(-COLOUR_RATE * delta);
    material.current.color.lerp(MOOD_COLOR3[mood], blend);
  });

  return (
    <group ref={root} position={start.position} rotation-y={start.yaw}>
      <group scale={scale}>
        {/* The pivot is at the feet, so the body squashes, stretches and tips about its base. */}
        <group ref={body}>
          <mesh geometry={BLOB_GEOMETRY[shape]} castShadow receiveShadow>
            <meshStandardMaterial ref={material} color={start.color} roughness={0.6} />
          </mesh>
          <BlobFace shape={shape} mood={mood} mouthRef={mouth} />
          {pose === "phone" && <Phone shape={shape} />}
        </group>
      </group>
      {talking && (
        <SpeechBubble height={ADULT_HEIGHT[shape] * scale[1] + 0.4} angry={mood === "angry"} />
      )}
    </group>
  );
}
