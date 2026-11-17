// Placeholder art for the city's screens until real content plugs in: news panels for the
// game's made-up Tallowick AI, and playful ads for made-up products. All fictional.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

const COMPANY = "TALLOWICK AI";
const NAVY = "#14213d";
const INK = "#1f2328";

/** One look per news screen, so the plaza doesn't show the same panel over and over. */
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

/** Made-up products for the ad screens: invented names, abstract art, no real brands. */
export const ADS = [
  {
    name: "FIZZLEPOP",
    line: "Totally made-up soda",
    bg: "#16a6a1",
    fg: "#fff6d5",
    accent: "#ff6b6b",
    art: "bubbles",
  },
  {
    name: "MOONCRUMB",
    line: "The cereal that isn't real",
    bg: "#3d2c8d",
    fg: "#ffe8a3",
    accent: "#ffb703",
    art: "moons",
  },
  {
    name: "BLORP",
    line: "Bubble gum from nowhere",
    bg: "#ff5d8f",
    fg: "#ffffff",
    accent: "#ffd23f",
    art: "dots",
  },
  {
    name: "WOBBLEBEE",
    line: "Scooters for nobody",
    bg: "#ffd166",
    fg: "#1d3557",
    accent: "#ef476f",
    art: "stripes",
  },
  {
    name: "GLIMMERJAM",
    line: "Imaginary tunes",
    bg: "#06d6a0",
    fg: "#073b4c",
    accent: "#118ab2",
    art: "zigzag",
  },
  {
    name: "SNOOZLE",
    line: "Pillows that don't exist",
    bg: "#118ab2",
    fg: "#ffffff",
    accent: "#ffd166",
    art: "triangles",
  },
  {
    name: "QUIBBLEBEAN",
    line: "Coffee for pretend",
    bg: "#6f4e37",
    fg: "#fff1d6",
    accent: "#e9c46a",
    art: "dots",
  },
  {
    name: "SPROCKETSOX",
    line: "Socks, but fictional",
    bg: "#e76f51",
    fg: "#ffffff",
    accent: "#264653",
    art: "stripes",
  },
] as const;

// Big, loose shapes in the ad's accent: colour blocks more than pictures.
function adArt(g: CanvasRenderingContext2D, w: number, h: number, ad: (typeof ADS)[number]) {
  const u = Math.min(w, h);
  g.fillStyle = ad.accent;
  g.globalAlpha = 0.85;
  const shapes = 7;
  for (let i = 0; i < shapes; i++) {
    // Spread along the long side, alternating high and low.
    const t = (i + 0.5) / shapes;
    const x = w >= h ? t * w : (i % 2 ? 0.7 : 0.3) * w;
    const y = w >= h ? (i % 2 ? 0.72 : 0.3) * h : t * h;
    const r = u * (0.12 + 0.05 * (i % 3));
    g.beginPath();
    if (ad.art === "bubbles" || ad.art === "dots") {
      g.arc(x, y, ad.art === "dots" ? r * 0.6 : r, 0, Math.PI * 2);
    } else if (ad.art === "moons") {
      g.arc(x, y, r, Math.PI * 0.3, Math.PI * 1.7);
      g.arc(x + r * 0.45, y, r * 0.8, Math.PI * 1.6, Math.PI * 0.4, true);
    } else if (ad.art === "triangles") {
      g.moveTo(x, y - r);
      g.lineTo(x + r, y + r);
      g.lineTo(x - r, y + r);
    } else if (ad.art === "stripes") {
      g.rect(
        w >= h ? x - r / 3 : 0,
        w >= h ? 0 : y - r / 3,
        w >= h ? r / 1.5 : w,
        w >= h ? h : r / 1.5,
      );
    } else {
      g.moveTo(x - r, y);
      g.lineTo(x - r / 3, y - r);
      g.lineTo(x + r / 3, y);
      g.lineTo(x + r, y - r);
      g.lineTo(x + r, y - r / 2);
      g.lineTo(x + r / 3, y + r / 2);
      g.lineTo(x - r / 3, y - r / 2);
      g.lineTo(x - r, y + r / 2);
    }
    g.fill();
  }
  g.globalAlpha = 1;
}

/**
 * An ad screen's placeholder: a made-up product's name over abstract colour blocks, marked
 * SIMULATED AD. Tall banners write the name along their length.
 */
export function adPlaceholder(aspect: number, ad: (typeof ADS)[number]): CanvasTexture {
  const canvas = document.createElement("canvas");
  const long = 768;
  canvas.width = aspect >= 1 ? long : Math.max(64, Math.round(long * aspect));
  canvas.height = aspect >= 1 ? Math.max(64, Math.round(long / aspect)) : long;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  const { width: w, height: h } = canvas;
  g.fillStyle = ad.bg;
  g.fillRect(0, 0, w, h);
  adArt(g, w, h, ad);

  // Lay the words along the long side.
  g.save();
  if (h > w) {
    g.translate(w / 2, h / 2);
    g.rotate(-Math.PI / 2);
    g.translate(-h / 2, -w / 2);
  }
  const length = Math.max(w, h);
  const across = Math.min(w, h);
  g.fillStyle = ad.fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 ${across * 0.36}px system-ui, sans-serif`;
  g.fillText(ad.name, length / 2, across * 0.44, length * 0.9);
  g.font = `600 ${across * 0.12}px system-ui, sans-serif`;
  g.fillText(ad.line, length / 2, across * 0.76, length * 0.9);
  g.font = `700 ${across * 0.08}px system-ui, sans-serif`;
  g.textAlign = "right";
  g.fillText("SIMULATED AD \u00b7 FICTIONAL PRODUCT", length - across * 0.08, across * 0.1);
  g.restore();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
