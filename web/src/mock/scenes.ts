// Procedural "photos" for mock mode: a flooded Huế street with shophouses and
// reference objects standing in the water, plus the matching model overlay
// (water mask, object masks, waterlines) drawn the way floodline/imaging.py does.

import { OVERLAY_PALETTE } from "../lib/format";

export type SceneLabel = "scooter" | "car" | "person" | "door";
export type Mood = "overcast" | "dusk" | "night";

export interface SceneObject {
  label: SceneLabel;
  /** horizontal centre, 0..800 */
  x: number;
  /** which plane: front objects are larger and lower in the frame */
  plane?: "front" | "mid" | "back";
  flip?: boolean;
  colour?: string;
}

export interface SceneSpec {
  seed: number;
  depth: number; // metres at the objects
  mood?: Mood;
  rain?: boolean;
  objects: SceneObject[];
}

const W = 800;
const H = 600;

// plane -> [ground y in px, px per metre]
const PLANES = {
  back: [392, 92],
  mid: [492, 118],
  front: [574, 168],
} as const;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Silhouettes at 100 px per metre, origin at the ground contact, y up is negative.
function scooter(colour: string): { body: string; outline: string; height: number; half: number } {
  const outline =
    "M-92 -36 C-96 -60 -78 -76 -48 -78 L-62 -84 C-58 -94 4 -94 18 -84 L14 -76 L26 -52 L44 -50 L54 -88 L58 -104 L52 -112 L66 -114 L70 -104 L66 -86 L74 -40 C80 -28 92 -20 90 -8 A28 28 0 0 1 34 -8 L-34 -8 A28 28 0 0 1 -92 -14 Z";
  const body = `
    <circle cx="-62" cy="-28" r="27" fill="#1d1f22"/><circle cx="-62" cy="-28" r="12" fill="#8d949a"/>
    <circle cx="62" cy="-28" r="27" fill="#1d1f22"/><circle cx="62" cy="-28" r="12" fill="#8d949a"/>
    <path d="M-90 -40 C-94 -62 -76 -76 -46 -76 L12 -72 L24 -50 L44 -48 L52 -84 L64 -86 L72 -40 L52 -34 L-30 -36 Z" fill="${colour}"/>
    <path d="M-20 -44 L44 -46 L46 -38 L-22 -36 Z" fill="#2a2c30"/>
    <path d="M-64 -80 C-58 -92 4 -92 18 -82 L14 -74 L-60 -74 Z" fill="#26282b"/>
    <path d="M54 -88 L58 -104 L64 -104 L68 -88 Z" fill="${colour}"/>
    <path d="M50 -110 L72 -114" stroke="#26282b" stroke-width="5" stroke-linecap="round"/>
    <circle cx="70" cy="-96" r="5" fill="#f3e3a0"/>
    <path d="M-86 -52 L-60 -54" stroke="#ffffff" stroke-opacity=".35" stroke-width="3"/>`;
  return { body, outline, height: 116, half: 92 };
}

function person(colour: string): { body: string; outline: string; height: number; half: number } {
  // A resident in a poncho-style raincoat (áo mưa), seen from the front.
  const outline =
    "M-11 -170 A12 12 0 1 1 11 -170 L12 -158 C26 -154 34 -146 36 -132 L42 -62 L18 -60 L16 0 L4 0 L0 -56 L-4 0 L-16 0 L-18 -60 L-42 -62 L-36 -132 C-34 -146 -26 -154 -12 -158 Z";
  const body = `
    <path d="M-16 -64 L-15 0 L-4 0 L0 -56 L4 0 L15 0 L16 -64 Z" fill="#2f3440"/>
    <path d="M-12 -158 C-26 -154 -34 -146 -36 -132 L-42 -62 L42 -62 L36 -132 C34 -146 26 -154 12 -158 Z" fill="${colour}"/>
    <path d="M-30 -120 L-34 -66 M30 -120 L34 -66" stroke="#000" stroke-opacity=".15" stroke-width="3"/>
    <circle cx="0" cy="-170" r="12" fill="#c99a76"/>
    <path d="M-14 -172 C-14 -188 14 -188 14 -172 C10 -178 -10 -178 -14 -172 Z" fill="${colour}"/>
    <path d="M-12 -162 C-8 -158 8 -158 12 -162" stroke="${colour}" stroke-width="4" fill="none"/>`;
  return { body, outline, height: 182, half: 42 };
}

function car(colour: string): { body: string; outline: string; height: number; half: number } {
  const outline =
    "M-214 -32 L-210 -70 L-150 -82 L-98 -132 L62 -136 L122 -86 L204 -78 L216 -40 L212 -10 L-212 -10 Z";
  const body = `
    <path d="M-214 -32 L-210 -70 L-150 -82 L-98 -132 L62 -136 L122 -86 L204 -78 L216 -40 L212 -18 L-212 -18 Z" fill="${colour}"/>
    <path d="M-140 -86 L-92 -124 L-12 -127 L-12 -88 Z" fill="#35424d"/>
    <path d="M0 -127 L56 -129 L104 -88 L0 -88 Z" fill="#35424d"/>
    <path d="M-18 -86 L-18 -30 M-130 -84 L-134 -30 M108 -86 L112 -30" stroke="#000" stroke-opacity=".22" stroke-width="2"/>
    <path d="M-60 -76 L-40 -76 M40 -76 L60 -76" stroke="#000" stroke-opacity=".4" stroke-width="4" stroke-linecap="round"/>
    <path d="M196 -64 L214 -62" stroke="#f3e3a0" stroke-width="7" stroke-linecap="round"/>
    <circle cx="-140" cy="-30" r="30" fill="#1d1f22"/><circle cx="-140" cy="-30" r="13" fill="#9aa1a7"/>
    <circle cx="140" cy="-30" r="30" fill="#1d1f22"/><circle cx="140" cy="-30" r="13" fill="#9aa1a7"/>`;
  return { body, outline, height: 136, half: 216 };
}

function door(colour: string): { body: string; outline: string; height: number; half: number } {
  // A roll-up shop shutter, 2.2 m tall.
  const slats = Array.from({ length: 18 }, (_, i) => {
    const y = -214 + i * 12;
    return `<path d="M-108 ${y} L108 ${y}" stroke="#000" stroke-opacity=".16" stroke-width="2"/>`;
  }).join("");
  const outline = "M-112 -222 L112 -222 L112 0 L-112 0 Z";
  const body = `<rect x="-112" y="-222" width="224" height="222" fill="${colour}"/>${slats}
    <rect x="-118" y="-232" width="236" height="12" fill="#5d6268"/>`;
  return { body, outline, height: 222, half: 112 };
}

const SHAPES = { scooter, person, car, door };
const DEFAULT_COLOUR: Record<SceneLabel, string> = {
  scooter: "#b23a35",
  person: "#2f6db3",
  car: "#d7d9dc",
  door: "#a9b0b6",
};

interface Placed {
  obj: SceneObject;
  shape: ReturnType<typeof scooter>;
  k: number; // px per (100 px per metre) unit
  ground: number;
  waterline: number;
  bbox: [number, number, number, number];
}

function place(spec: SceneSpec): Placed[] {
  return spec.objects.map((obj) => {
    const plane = obj.label === "door" ? "back" : obj.plane ?? (obj.label === "car" ? "mid" : "front");
    const [ground, ppm] = PLANES[plane];
    const k = ppm / 100;
    const shape = SHAPES[obj.label](obj.colour ?? DEFAULT_COLOUR[obj.label]);
    const waterline = ground - spec.depth * ppm;
    const bbox: [number, number, number, number] = [
      Math.round(obj.x - shape.half * k),
      Math.round(ground - shape.height * k),
      Math.round(obj.x + shape.half * k),
      Math.round(ground),
    ];
    return { obj, shape, k, ground, waterline, bbox };
  });
}

function transform(p: Placed): string {
  const flip = p.obj.flip ? -1 : 1;
  return `translate(${p.obj.x} ${p.ground}) scale(${p.k * flip} ${p.k})`;
}

function background(spec: SceneSpec, r: () => number): string {
  const mood = spec.mood ?? "overcast";
  const sky =
    mood === "night"
      ? ["#141b26", "#2a3442"]
      : mood === "dusk"
        ? ["#5b6476", "#b09a8a"]
        : ["#8f9aa3", "#c8cdd0"];
  const facades =
    mood === "night"
      ? ["#4a4a3e", "#34474a", "#4b3c39", "#45464a", "#3b4250"]
      : ["#d6bf7c", "#86aaa2", "#cf9c86", "#d9cdb3", "#93a2b4", "#c7b9d0"];
  let out = `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${mood === "night" ? "#3f3a2c" : "#8f7f58"}"/>
      <stop offset="1" stop-color="${mood === "night" ? "#272418" : "#5f5236"}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  // shophouses
  let x = -20;
  while (x < W) {
    const w = 120 + Math.floor(r() * 70);
    const top = 40 + Math.floor(r() * 120);
    const c = facades[Math.floor(r() * facades.length)];
    out += `<rect x="${x}" y="${top}" width="${w}" height="${392 - top}" fill="${c}"/>`;
    out += `<rect x="${x}" y="${top}" width="${w}" height="8" fill="#000" fill-opacity=".12"/>`;
    // upper windows and balcony
    for (let y = top + 26; y < 250; y += 70) {
      const lit = mood === "night" && r() > 0.45;
      out += `<rect x="${x + w * 0.2}" y="${y}" width="${w * 0.6}" height="38" fill="${lit ? "#e8c66a" : "#3d4852"}" fill-opacity="${lit ? 0.9 : 0.75}"/>`;
      out += `<rect x="${x + w * 0.12}" y="${y + 40}" width="${w * 0.76}" height="5" fill="#000" fill-opacity=".25"/>`;
    }
    // signboard
    const sign = ["#b3352f", "#1f5aa6", "#2c7a4b", "#c58b1c"][Math.floor(r() * 4)];
    out += `<rect x="${x + 8}" y="262" width="${w - 16}" height="26" fill="${sign}" fill-opacity=".9"/>`;
    out += `<rect x="${x + 18}" y="271" width="${(w - 36) * (0.4 + r() * 0.4)}" height="8" fill="#fff" fill-opacity=".7"/>`;
    // ground-floor shutter
    out += `<rect x="${x + 10}" y="296" width="${w - 20}" height="96" fill="#7d858c"/>`;
    for (let y = 302; y < 392; y += 9)
      out += `<path d="M${x + 10} ${y} H${x + w - 10}" stroke="#000" stroke-opacity=".14" stroke-width="2"/>`;
    x += w;
  }
  // power lines
  out += `<path d="M-10 70 Q 400 130 810 60" stroke="#1d2126" stroke-width="2" fill="none" opacity=".7"/>`;
  out += `<path d="M-10 92 Q 380 150 810 86" stroke="#1d2126" stroke-width="1.6" fill="none" opacity=".6"/>`;
  // kerb and street
  out += `<rect x="0" y="392" width="${W}" height="${H - 392}" fill="#5a5d5f"/>`;
  return out;
}

function waterBody(spec: SceneSpec): { top: number; svg: string } {
  const top = PLANES.back[0] - spec.depth * PLANES.back[1];
  let svg = `<rect x="0" y="${top}" width="${W}" height="${H - top}" fill="url(#water)" fill-opacity=".96"/>`;
  svg += `<rect x="0" y="${top}" width="${W}" height="3" fill="#fff" fill-opacity=".18"/>`;
  for (let i = 0; i < 26; i++) {
    const y = top + 12 + ((i * 37) % (H - top - 12));
    const x = (i * 131) % W;
    const len = 30 + ((i * 17) % 60);
    svg += `<path d="M${x} ${y} q ${len / 2} -4 ${len} 0" stroke="#fff" stroke-opacity=".14" stroke-width="2" fill="none"/>`;
  }
  return { top, svg };
}

function rain(): string {
  let s = "";
  for (let i = 0; i < 90; i++) {
    const x = (i * 97) % W;
    const y = (i * 53) % H;
    s += `<path d="M${x} ${y} l -6 18" stroke="#e6eef5" stroke-opacity=".28" stroke-width="1.2"/>`;
  }
  return s;
}

function drawObject(p: Placed, i: number): string {
  const clipAbove = `clip-above-${i}`;
  const clipBelow = `clip-below-${i}`;
  return `
  <clipPath id="${clipAbove}"><rect x="0" y="0" width="${W}" height="${p.waterline}"/></clipPath>
  <clipPath id="${clipBelow}"><rect x="0" y="${p.waterline}" width="${W}" height="${H - p.waterline}"/></clipPath>
  <g clip-path="url(#${clipBelow})" opacity=".2"><g transform="${transform(p)}">${p.shape.body}</g></g>
  <g clip-path="url(#${clipAbove})"><g transform="${transform(p)}">${p.shape.body}</g></g>
  <ellipse cx="${p.obj.x}" cy="${p.waterline + 2}" rx="${(p.bbox[2] - p.bbox[0]) * 0.56}" ry="${4 + p.k * 3}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2"/>`;
}

function overlayLayer(placed: Placed[], waterTop: number): string {
  let s = `<rect x="0" y="${waterTop}" width="${W}" height="${H - waterTop}" fill="rgb(30,90,255)" fill-opacity=".38"/>`;
  placed.forEach((p, i) => {
    const colour = OVERLAY_PALETTE[i % OVERLAY_PALETTE.length];
    s += `<clipPath id="ov-${i}"><rect x="0" y="0" width="${W}" height="${p.waterline}"/></clipPath>`;
    s += `<g clip-path="url(#ov-${i})"><path transform="${transform(p)}" d="${p.shape.outline}" fill="${colour}" fill-opacity=".55" stroke="${colour}" stroke-width="${3 / p.k}"/></g>`;
  });
  placed.forEach((p, i) => {
    const colour = OVERLAY_PALETTE[i % OVERLAY_PALETTE.length];
    const [x0, y0, x1] = p.bbox;
    s += `<path d="M${x0 - 6} ${p.waterline} H${x1 + 6}" stroke="#fff" stroke-width="5"/>`;
    s += `<path d="M${x0 - 6} ${p.waterline} H${x1 + 6}" stroke="${colour}" stroke-width="3"/>`;
    s += `<text x="${x0 + 4}" y="${y0 + 16}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${i + 1} ${p.obj.label}</text>`;
  });
  return s;
}

export interface RenderedScene {
  image: string;
  overlay: string;
  boxes: [number, number, number, number][];
  waterlines: number[];
  waterFraction: number;
  size: [number, number];
}

function uri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function renderScene(spec: SceneSpec): RenderedScene {
  const r = rng(spec.seed);
  const placed = place(spec)
    // draw far objects first
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.ground - b.p.ground);
  const ordered = placed.map((x) => x.p);
  const bg = background(spec, r);
  const water = waterBody(spec);
  const objects = ordered.map((p, i) => drawObject(p, i)).join("");
  const night = spec.mood === "night" ? `<rect width="${W}" height="${H}" fill="#0b1220" fill-opacity=".25"/>` : "";
  const photo = `${bg}${water.svg}${objects}${spec.rain ? rain() : ""}${night}`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  const image = `${open}${photo}</svg>`;
  // Overlay: the photo desaturated, then the masks in input order.
  const inOrder = placed.sort((a, b) => a.i - b.i).map((x) => x.p);
  const overlay = `${open}<defs><filter id="desat"><feColorMatrix type="saturate" values=".35"/></filter></defs>
    <g filter="url(#desat)">${photo}</g>${overlayLayer(inOrder, water.top)}</svg>`;
  return {
    image: uri(image),
    overlay: uri(overlay),
    boxes: inOrder.map((p) => p.bbox),
    waterlines: inOrder.map((p) => Math.round(p.waterline)),
    waterFraction: Math.round(((H - water.top) / H) * 0.86 * 10000) / 10000,
    size: [W, H],
  };
}
