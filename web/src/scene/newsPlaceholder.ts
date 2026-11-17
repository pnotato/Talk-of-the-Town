// Placeholder art for the city's screens until a real (simulated) news story plugs in.
// Everything here is fictional: the company is the game's made-up Tallowick AI.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

const COMPANY = "TALLOWICK AI";
const NAVY = "#14213d";
const INK = "#1f2328";

/** One look per screen, so the plaza doesn't show the same panel six times. */
export const SCREEN_LOOKS = [
  { kicker: "BREAKING", accent: "#e63946" },
  { kicker: "LIVE", accent: "#2a9d8f" },
  { kicker: "UPDATE", accent: "#f4a261" },
  { kicker: "TRENDING", accent: "#8e7dbe" },
] as const;

const RESOLUTION = 1024; // canvas width; height follows the screen's aspect

function badge(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  g.font = `700 ${size}px system-ui, sans-serif`;
  const w = g.measureText("SIMULATED").width + size;
  g.fillStyle = "#ffffff";
  g.fillRect(x, y, w, size * 1.5);
  g.strokeStyle = INK;
  g.lineWidth = size * 0.12;
  g.strokeRect(x, y, w, size * 1.5);
  g.fillStyle = INK;
  g.textBaseline = "middle";
  g.fillText("SIMULATED", x + size / 2, y + size * 0.78);
}

/**
 * A screen's placeholder: SIMULATED badge, the fictional company, a kicker and a headline
 * area that says the story is still to come. Drawn once at the screen's aspect.
 */
export function newsPlaceholder(
  aspect: number,
  look: (typeof SCREEN_LOOKS)[number],
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = RESOLUTION;
  canvas.height = Math.round(RESOLUTION / aspect);
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  const { width: w, height: h } = canvas;
  const u = h / 10; // layout unit

  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, NAVY);
  sky.addColorStop(1, "#24375e");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.fillStyle = look.accent;
  g.fillRect(0, h - u * 1.1, w, u * 1.1);

  badge(g, u * 0.6, u * 0.6, u * 0.8);
  g.textBaseline = "alphabetic";
  g.fillStyle = "#ffffff";
  g.font = `800 ${u * 1.1}px system-ui, sans-serif`;
  g.textAlign = "right";
  g.fillText(COMPANY, w - u * 0.6, u * 1.6);

  g.textAlign = "left";
  g.fillStyle = look.accent;
  g.font = `800 ${u * 1.2}px system-ui, sans-serif`;
  g.fillText(look.kicker, u * 0.6, u * 4.2);
  g.fillStyle = "#ffffff";
  g.font = `800 ${u * 1.9}px system-ui, sans-serif`;
  g.fillText("Today's story", u * 0.6, u * 6.3, w - u * 1.2);
  g.fillText("appears here", u * 0.6, u * 8.3, w - u * 1.2);

  g.fillStyle = "#ffffff";
  g.font = `600 ${u * 0.55}px system-ui, sans-serif`;
  g.textAlign = "right";
  g.fillText("A fictional company. Not a real business.", w - u * 0.6, h - u * 0.35);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A strip of news that repeats along x; scroll it by moving texture.offset.x. */
export function newsTicker(): CanvasTexture {
  const items = [
    "SIMULATED NEWS",
    `${COMPANY} SAYS A NEW FEATURE IS COMING`,
    "STORY DEVELOPING",
    "ALL COMPANIES FICTIONAL",
  ];
  const font = "700 38px system-ui, sans-serif";
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  // As wide as the items, so the strip repeats without a gap or a cut.
  g.font = font;
  const step = (item: string) => 44 + g.measureText(item).width + 48;
  canvas.width = Math.ceil(items.reduce((sum, item) => sum + step(item), 24));
  canvas.height = 64;
  g.fillStyle = "#0b1020";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = font; // resizing the canvas reset it
  g.textBaseline = "middle";
  let x = 24;
  for (const item of items) {
    g.fillStyle = "#ffd166";
    g.fillText("◆", x, 33);
    g.fillStyle = "#ffffff";
    g.fillText(item, x + 44, 33);
    x += step(item);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}
