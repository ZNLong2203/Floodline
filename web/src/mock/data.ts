// Mock reports on real Huế streets. Readings use the landmark and size ranges of
// data/catalog.yaml, and the estimate, verdicts and priority are computed with the
// same formulas as the backend, so everything on screen is internally consistent.
import { FALLBACK_VEHICLES } from "../lib/catalog";
import { assess, CALIBRATION_FITTED, calibrate, COMBINE_FACTOR, combine, type WorkingReading } from "../lib/passability";
import type { Analysis, ObjectFinding, Reading, Report, ReportStatus, TriageFacts } from "../lib/types";
import { renderScene, type Mood, type SceneObject } from "./scenes";

type Label = "scooter" | "car" | "person" | "door";

const HEIGHT: Record<Label, [number, number]> = {
  scooter: [1.04, 1.13],
  car: [1.45, 1.75],
  person: [1.55, 1.7],
  door: [2.0, 2.6],
};

const LANDMARKS: Record<string, [number, number]> = {
  "scooter.below_wheel_hub": [0.05, 0.27],
  "scooter.wheel_hub": [0.25, 0.32],
  "scooter.footboard": [0.3, 0.45],
  "scooter.seat": [0.74, 0.8],
  "scooter.above_seat": [0.8, 1.1],
  "car.wheel_hub": [0.28, 0.36],
  "car.sill": [0.35, 0.5],
  "car.door_handle": [0.85, 1.05],
  "person.ankle": [0.05, 0.15],
  "person.knee": [0.4, 0.52],
  "person.thigh": [0.55, 0.75],
  "person.waist": [0.85, 1.05],
  "person.chest": [1.1, 1.3],
  "door.door_handle": [0.9, 1.1],
};

interface ObjSpec {
  label: Label;
  x: number;
  orientation: "side" | "front_or_back" | "oblique";
  landmark: string;
  fraction?: number;
  scale?: [number, number, string];
  /** Spark's second look at an enlarged crop of the object. */
  closeup?: { landmark?: string; fraction?: number; confidence: "low" | "medium" | "high" };
  standing?: boolean;
  plane?: SceneObject["plane"];
  flip?: boolean;
  colour?: string;
}

interface Spec {
  key: string;
  lat: number;
  lon: number;
  minutesAgo: number;
  status: ReportStatus;
  source: string;
  note: string;
  transcript?: string;
  depth: number; // for the scene
  mood?: Mood;
  rain?: boolean;
  flow: "still" | "slow" | "fast" | "unclear";
  flags?: string[];
  objects: ObjSpec[];
  holistic: [number, number];
  people: { count: number; children_or_elderly: boolean; on_roof_or_upper_floor: boolean; signalling_for_help: boolean };
  summary: string;
  facts: TriageFacts | null;
  noWater?: boolean;
  seed: number;
}

const r = (lo: number, hi: number) => [Math.round(lo * 1000) / 1000, Math.round(hi * 1000) / 1000] as const;

function readingsFor(o: ObjSpec, i: number): WorkingReading[] {
  const tag = `${o.label}#${i + 1}`;
  const out: Reading[] = [];
  if (o.standing === false) return out;
  if (o.scale) out.push({ source: `scale:${tag}`, low_m: o.scale[0], high_m: o.scale[1], note: o.scale[2] });
  const lm = LANDMARKS[`${o.label}.${o.landmark}`];
  if (lm) out.push({ source: `landmark:${tag}`, low_m: lm[0], high_m: lm[1], note: o.landmark });
  const frac = (f: number) => {
    const [h0, h1] = HEIGHT[o.label];
    return r(Math.max(0, f - 0.12) * h0, Math.min(1, f + 0.12) * h1);
  };
  if (o.fraction != null) {
    const [lo, hi] = frac(o.fraction);
    out.push({ source: `fraction:${tag}`, low_m: lo, high_m: hi, note: o.fraction.toFixed(2) });
  }
  const c = o.closeup;
  if (c?.landmark) {
    const clm = LANDMARKS[`${o.label}.${c.landmark}`];
    if (clm) out.push({ source: `closeup-landmark:${tag}`, low_m: clm[0], high_m: clm[1], note: `${c.landmark} (${c.confidence})` });
  }
  if (c?.fraction != null) {
    const [lo, hi] = frac(c.fraction);
    out.push({ source: `closeup-fraction:${tag}`, low_m: lo, high_m: hi, note: `${c.fraction.toFixed(2)} (${c.confidence})` });
  }
  return calibrate(out);
}

/** floodline/triage.py score() */
export function score(facts: TriageFacts | null, depth: number | null): [number, string[]] {
  let points = 0;
  const why: string[] = [];
  const f = facts ?? ({} as Partial<TriageFacts>);
  if (f.injury_or_medical) {
    points += 30;
    why.push("injury or medical need");
  }
  const vul = f.vulnerable ?? [];
  if (vul.length) {
    points += 10 + 5 * Math.min(vul.length, 3);
    why.push(`vulnerable: ${vul.join(", ")}`);
  }
  if (f.trapped) {
    points += 15;
    why.push("trapped");
  }
  if (f.water_rising === "yes") {
    points += 10;
    why.push("water rising");
  }
  if (depth != null) {
    if (depth >= 1) {
      points += 20;
      why.push(`depth ${depth.toFixed(1)} m`);
    } else if (depth >= 0.5) {
      points += 10;
      why.push(`depth ${depth.toFixed(1)} m`);
    }
  }
  const people = f.people_count ?? 0;
  if (people >= 5) {
    points += 5;
    why.push(`${people} people`);
  }
  return [Math.min(points, 100), why];
}

export function reportId(at: number): string {
  const d = new Date(at * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const hex = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${hex}`;
}

export function build(spec: Spec, now: number): Report {
  const scene = renderScene({
    seed: spec.seed,
    depth: spec.noWater ? 0 : spec.depth,
    mood: spec.mood,
    rain: spec.rain,
    objects: spec.objects.map((o) => ({ label: o.label, x: o.x, plane: o.plane, flip: o.flip, colour: o.colour })),
  });
  const objects: ObjectFinding[] = spec.objects.map((o, i) => {
    const box = scene.boxes[i];
    const wl = scene.waterlines[i];
    return {
      index: i,
      label: o.label,
      orientation: o.orientation,
      landmark: o.landmark,
      box_px: box,
      standing_in_water: o.standing !== false,
      sam_confidence: Math.round((0.82 + ((spec.seed * (i + 3)) % 17) / 100) * 100) / 100,
      contact:
        o.standing === false
          ? null
          : {
              top_y: box[1],
              waterline_y: wl,
              visible_height_px: wl - box[1],
              width_px: box[2] - box[0],
              contact_fraction: 0.86,
              columns: box[2] - box[0],
            },
      readings: readingsFor(o, i).map(({ sd: _sd, ...rest }) => rest),
    };
  });
  const working = spec.objects.flatMap((o, i) => readingsFor(o, i));
  if (!spec.noWater)
    working.push(
      ...calibrate([{ source: "spark:holistic", low_m: spec.holistic[0], high_m: spec.holistic[1], note: "Spark's own range" }]),
    );
  const estimate = spec.noWater ? null : combine(working, 3, COMBINE_FACTOR);
  const flowing = spec.flow === "fast";
  const verdicts = estimate ? assess(estimate, FALLBACK_VEHICLES, flowing) : [];
  const warnings = [
    ...(spec.noWater ? ["no water found in the photo"] : []),
    ...(spec.flags ?? []).map((f) => `photo: ${f.replace(/_/g, " ")}`),
  ];
  const analysis: Analysis = {
    size: scene.size,
    perception: {
      is_flood_photo: !spec.noWater,
      water_visible: !spec.noWater,
      setting: "street",
      quality_flags: spec.flags ?? [],
      water_flow: spec.flow,
      people: spec.people,
      references: [],
      holistic_depth_m: { low: spec.holistic[0], high: spec.holistic[1] },
      summary_vi: spec.summary,
    },
    objects,
    estimate,
    verdicts,
    water_fraction: spec.noWater ? 0 : scene.waterFraction,
    seconds: 10 + (spec.seed % 70) / 10,
    warnings,
    calibration: CALIBRATION_FITTED,
  };
  const [priority, reasons] = score(spec.facts, estimate?.mean_m ?? null);
  const at = now - spec.minutesAgo * 60;
  const en = ENGLISH[spec.key];
  const facts: TriageFacts | null = spec.facts
    ? {
        ...spec.facts,
        language: "vi",
        message_en: en?.message,
        summary_en: en?.summary,
        summary_local: spec.facts.summary_vi,
        dispatch_en: en?.dispatch,
        dispatch_local: spec.facts.dispatch_vi,
        summary_vi: undefined,
        dispatch_vi: undefined,
      }
    : null;
  return {
    id: reportId(at),
    city: "hue",
    lat: spec.lat,
    lon: spec.lon,
    at,
    note: spec.note,
    source: spec.source,
    status: spec.status,
    transcript: spec.transcript ?? null,
    triage: { priority, reasons, facts },
    analysis,
    image_url: scene.image,
    overlay_url: scene.overlay,
  };
}

export const SPECS: Spec[] = [
  {
    key: "tran-hung-dao",
    lat: 16.46894,
    lon: 107.5857,
    minutesAgo: 6,
    status: "new",
    source: "web",
    note: "Nhà có 2 ông bà già, nước vào nhà rồi, không ra được",
    depth: 0.76,
    rain: true,
    flow: "still",
    seed: 11,
    objects: [
      { label: "scooter", x: 290, orientation: "side", landmark: "seat", fraction: 0.68, scale: [0.68, 0.81, "71px visible of 309px wide"], closeup: { landmark: "seat", fraction: 0.7, confidence: "high" }, colour: "#b23a35" },
      { label: "person", x: 590, orientation: "front_or_back", landmark: "knee", fraction: 0.45, colour: "#2f6db3" },
    ],
    holistic: [0.6, 0.9],
    people: { count: 1, children_or_elderly: false, on_roof_or_upper_floor: false, signalling_for_help: false },
    summary: "Nước ngập ngang yên xe máy trên đường Trần Hưng Đạo, gần cửa Thượng Tứ.",
    facts: {
      people_count: 2,
      vulnerable: ["elderly"],
      injury_or_medical: false,
      water_rising: "yes",
      trapped: true,
      needs: ["evacuation", "boat"],
      address_hint: "Kiệt nhỏ đường Trần Hưng Đạo, gần cửa Thượng Tứ",
      summary_vi: "2 người già mắc kẹt trong nhà, nước ngang yên xe máy và đang lên.",
      dispatch_vi:
        "Cần thuyền tới kiệt đường Trần Hưng Đạo (gần cửa Thượng Tứ): 2 người già mắc kẹt, nước 0,7–0,8 m và đang lên. Xe tải không vào được.",
    },
  },
  {
    key: "kim-long",
    lat: 16.45919,
    lon: 107.56476,
    minutesAgo: 14,
    status: "acknowledged",
    source: "web",
    note: "",
    transcript:
      "Alo, nhà tôi ở kiệt 20 Kim Long, nước lên tới ngực rồi, mẹ tôi bị ngã chảy máu chân, có hai đứa nhỏ, cần thuyền gấp.",
    depth: 1.22,
    mood: "dusk",
    flow: "slow",
    seed: 23,
    objects: [
      { label: "person", x: 330, orientation: "front_or_back", landmark: "chest", fraction: 0.74, closeup: { landmark: "chest", confidence: "medium" }, colour: "#c58b1c" },
      { label: "door", x: 140, orientation: "front_or_back", landmark: "unclear", fraction: 0.55, colour: "#8f9aa4" },
      { label: "car", x: 610, orientation: "side", landmark: "unclear", fraction: 0.25, flip: true, colour: "#e0e2e4" },
    ],
    holistic: [1.0, 1.5],
    people: { count: 1, children_or_elderly: false, on_roof_or_upper_floor: false, signalling_for_help: true },
    summary: "Nước chảy, ngập tới ngực người lớn ở kiệt Kim Long; ô tô gần như chìm hẳn.",
    facts: {
      people_count: 4,
      vulnerable: ["elderly", "child"],
      injury_or_medical: true,
      water_rising: "yes",
      trapped: true,
      needs: ["boat", "medical", "evacuation"],
      address_hint: "Kiệt 20 Kim Long",
      summary_vi: "Cụ bà bị ngã chảy máu chân, 2 trẻ nhỏ, nước tới ngực và đang lên; cần thuyền gấp.",
      dispatch_vi:
        "KHẨN: Kiệt 20 Kim Long — 4 người (1 cụ bà bị thương chảy máu chân, 2 trẻ nhỏ) mắc kẹt, nước 1,1–1,4 m, nước chảy. Cần xuồng và sơ cứu.",
    },
  },
  {
    key: "bach-dang",
    lat: 16.48081,
    lon: 107.5842,
    minutesAgo: 38,
    status: "dispatched",
    source: "zalo",
    note: "Gia đình 5 người trên gác, có em bé 6 tháng và bà nội, hết nước uống",
    depth: 1.05,
    mood: "night",
    rain: true,
    flow: "still",
    flags: ["low_light"],
    seed: 37,
    objects: [
      { label: "person", x: 420, orientation: "side", landmark: "waist", fraction: 0.6, colour: "#3b7d4f" },
      { label: "door", x: 650, orientation: "front_or_back", landmark: "unclear", fraction: 0.45, colour: "#7d868e" },
    ],
    holistic: [0.9, 1.3],
    people: { count: 1, children_or_elderly: false, on_roof_or_upper_floor: false, signalling_for_help: false },
    summary: "Đường Bạch Đằng ngập ngang thắt lưng người lớn, trời tối.",
    facts: {
      people_count: 5,
      vulnerable: ["infant", "elderly"],
      injury_or_medical: false,
      water_rising: "unknown",
      trapped: true,
      needs: ["boat", "food", "water"],
      address_hint: "Đường Bạch Đằng, phường Gia Hội",
      summary_vi: "5 người trên gác, có trẻ 6 tháng tuổi và người già, hết nước uống.",
      dispatch_vi:
        "Bạch Đằng (Gia Hội): 5 người trên gác gồm trẻ 6 tháng và người già, nước 0,9–1,1 m. Mang nước uống, sữa, lương thực; cần thuyền.",
    },
  },
  {
    key: "le-duan",
    lat: 16.46685,
    lon: 107.58305,
    minutesAgo: 22,
    status: "new",
    source: "web",
    note: "Lê Duẩn đoạn cửa Ngăn ngập quá bánh xe, nhiều xe máy chết máy, nước vẫn lên",
    depth: 0.42,
    flow: "still",
    seed: 41,
    objects: [
      { label: "car", x: 470, orientation: "side", landmark: "sill", fraction: 0.28, scale: [0.36, 0.49, "88px visible of 506px wide"], colour: "#c9ccd0" },
      { label: "scooter", x: 150, orientation: "side", landmark: "footboard", plane: "front", flip: true, colour: "#2a56a0" },
    ],
    holistic: [0.3, 0.5],
    people: { count: 0, children_or_elderly: false, on_roof_or_upper_floor: false, signalling_for_help: false },
    summary: "Lê Duẩn trước cửa Ngăn ngập tới bậu cửa ô tô.",
    facts: {
      people_count: 0,
      vulnerable: [],
      injury_or_medical: false,
      water_rising: "yes",
      trapped: false,
      needs: ["info"],
      address_hint: "Đường Lê Duẩn, đoạn cửa Ngăn",
      summary_vi: "Lê Duẩn đoạn cửa Ngăn ngập 0,4 m, xe máy chết máy, nước đang lên.",
      dispatch_vi: "Lê Duẩn (cửa Ngăn) ngập 0,35–0,5 m và đang lên. Xe máy, ô tô con không qua được; xe tải cứu hộ qua được.",
    },
  },
  {
    key: "ba-trieu",
    lat: 16.46598,
    lon: 107.59977,
    minutesAgo: 112,
    status: "closed",
    source: "web",
    note: "Nước ngập tới trục bánh xe, xe máy đi chậm vẫn qua",
    depth: 0.2,
    flow: "still",
    seed: 53,
    objects: [
      { label: "scooter", x: 380, orientation: "side", landmark: "below_wheel_hub", fraction: 0.2, scale: [0.17, 0.28, "182px visible of 311px wide"], colour: "#d8d8d8" },
      { label: "person", x: 640, orientation: "front_or_back", landmark: "thigh", colour: "#b8422f" },
    ],
    holistic: [0.15, 0.3],
    people: { count: 1, children_or_elderly: false, on_roof_or_upper_floor: false, signalling_for_help: false },
    summary: "Bà Triệu ngập dưới trục bánh xe máy.",
    facts: {
      people_count: 0,
      vulnerable: [],
      injury_or_medical: false,
      water_rising: "no",
      trapped: false,
      needs: ["info"],
      address_hint: "Đường Bà Triệu",
      summary_vi: "Bà Triệu ngập khoảng 0,2 m; xe máy đi chậm vẫn qua được.",
      dispatch_vi: "Bà Triệu ngập 0,1–0,3 m, nước không lên thêm. Xe tải cứu hộ qua được.",
    },
  },
  {
    key: "phan-dinh-phung",
    lat: 16.45641,
    lon: 107.59072,
    minutesAgo: 3,
    status: "new",
    source: "web",
    note: "",
    transcript:
      "Vợ tôi đang mang thai tháng thứ chín, bắt đầu đau bụng rồi. Nhà ở kiệt 63 Phan Đình Phùng, nước ngang đùi, xe máy không đi được. Xin giúp đưa đi bệnh viện.",
    depth: 0.64,
    rain: true,
    flow: "still",
    seed: 67,
    objects: [
      { label: "person", x: 250, orientation: "front_or_back", landmark: "thigh", fraction: 0.4, closeup: { landmark: "thigh", fraction: 0.42, confidence: "high" }, colour: "#d9a531" },
      { label: "car", x: 560, orientation: "side", landmark: "sill", scale: [0.55, 0.69, "112px visible of 506px wide"], colour: "#3c4f6b" },
    ],
    holistic: [0.5, 0.8],
    people: { count: 1, children_or_elderly: false, on_roof_or_upper_floor: false, signalling_for_help: false },
    summary: "Kiệt Phan Đình Phùng ngập ngang đùi, ô tô ngập quá bậu cửa.",
    facts: {
      people_count: 3,
      vulnerable: ["pregnant"],
      injury_or_medical: true,
      water_rising: "no",
      trapped: true,
      needs: ["medical", "evacuation"],
      address_hint: "Kiệt 63 Phan Đình Phùng",
      summary_vi: "Sản phụ mang thai tháng 9 bắt đầu đau bụng, cần đưa tới bệnh viện; nước ngang đùi.",
      dispatch_vi:
        "KHẨN: Kiệt 63 Phan Đình Phùng — sản phụ tháng 9 chuyển dạ, cần đưa tới BV Trung ương Huế. Nước 0,55–0,7 m: dùng xe tải cứu hộ hoặc xuồng.",
    },
  },
  {
    key: "nguyen-hue",
    lat: 16.45768,
    lon: 107.5875,
    minutesAgo: 47,
    status: "acknowledged",
    source: "hotline",
    note: "Nguyễn Huệ gần ngã tư Lý Thường Kiệt nước lấp xấp, xe máy vẫn đi được",
    depth: 0.12,
    flow: "still",
    seed: 79,
    objects: [
      { label: "scooter", x: 320, orientation: "side", landmark: "below_wheel_hub", scale: [0.06, 0.17, "221px visible of 312px wide"], colour: "#1f1f22" },
      { label: "person", x: 600, orientation: "front_or_back", landmark: "ankle", colour: "#6b4ba3" },
    ],
    holistic: [0.05, 0.2],
    people: { count: 1, children_or_elderly: false, on_roof_or_upper_floor: false, signalling_for_help: false },
    summary: "Nguyễn Huệ ngập nhẹ, khoảng mắt cá chân.",
    facts: {
      people_count: 0,
      vulnerable: [],
      injury_or_medical: false,
      water_rising: "no",
      trapped: false,
      needs: ["info"],
      address_hint: "Nguyễn Huệ gần ngã tư Lý Thường Kiệt",
      summary_vi: "Nguyễn Huệ nước lấp xấp mắt cá, xe máy vẫn đi được.",
      dispatch_vi: "Nguyễn Huệ (ngã tư Lý Thường Kiệt) ngập 0,05–0,2 m, đi lại được.",
    },
  },
  {
    key: "kiet-ba-trieu-night",
    lat: 16.46345,
    lon: 107.59965,
    minutesAgo: 9,
    status: "new",
    source: "web",
    note: "Có người kêu cứu ở kiệt 116 Bà Triệu, trời tối quá không thấy gì, nhà bên cạnh có 2 người",
    depth: 0.1,
    mood: "night",
    rain: true,
    flow: "unclear",
    flags: ["low_light", "motion_blur", "water_surface_unclear"],
    noWater: true,
    seed: 89,
    objects: [],
    holistic: [0, 0],
    people: { count: 0, children_or_elderly: false, on_roof_or_upper_floor: false, signalling_for_help: false },
    summary: "Ảnh chụp ban đêm, quá tối, không xác định được mực nước.",
    facts: {
      people_count: 2,
      vulnerable: [],
      injury_or_medical: false,
      water_rising: "unknown",
      trapped: true,
      needs: ["evacuation"],
      address_hint: "Kiệt 116 Bà Triệu",
      summary_vi: "Có người kêu cứu ở kiệt 116 Bà Triệu; ảnh quá tối, chưa đo được mực nước.",
      dispatch_vi: "Kiệt 116 Bà Triệu: 2 người kêu cứu, chưa rõ mực nước (ảnh quá tối). Cần xác minh.",
    },
  },
];

/** Arrives over the (simulated) live stream a few seconds after the console opens. */
export const LATE_SPEC: Spec = {
  key: "dinh-tien-hoang",
  lat: 16.47318,
  lon: 107.58132,
  minutesAgo: 0,
  status: "new",
  source: "web",
  note: "Chồng tôi bị liệt nằm một chỗ, nước vào nhà gần tới giường, nước đang lên nhanh",
  depth: 0.92,
  flow: "still",
  seed: 97,
  objects: [
    { label: "person", x: 300, orientation: "front_or_back", landmark: "waist", fraction: 0.55, closeup: { landmark: "waist", confidence: "low" }, colour: "#a83a6a" },
    { label: "door", x: 620, orientation: "front_or_back", landmark: "unclear", fraction: 0.38, colour: "#9aa3aa" },
    { label: "scooter", x: 520, orientation: "side", landmark: "above_seat", plane: "front", colour: "#2f7f6d" },
  ],
  holistic: [0.7, 1.1],
  people: { count: 1, children_or_elderly: false, on_roof_or_upper_floor: false, signalling_for_help: true },
  summary: "Đinh Tiên Hoàng ngập gần tới thắt lưng, xe máy chìm quá yên.",
  facts: {
    people_count: 2,
    vulnerable: ["disabled"],
    injury_or_medical: false,
    water_rising: "yes",
    trapped: true,
    needs: ["evacuation", "boat"],
    address_hint: "Đường Đinh Tiên Hoàng, trong Thành nội",
    summary_vi: "Người bị liệt nằm một chỗ, nước gần tới giường và đang lên nhanh.",
    dispatch_vi:
      "Đinh Tiên Hoàng (Thành nội): 1 người bị liệt cần cáng, nước 0,8–1,0 m và đang lên nhanh. Cần xuồng và 2 người khiêng.",
  },
};

/** English for the mock reports, as Muse Spark's triage would return it. */
const ENGLISH: Record<string, { message?: string; summary: string; dispatch: string }> = {
  "tran-hung-dao": {
    message: "There are two elderly people at home, the water is already inside and they can't get out.",
    summary: "2 elderly people trapped at home; water at scooter-seat height and rising.",
    dispatch:
      "Send a boat to the lane off Trần Hưng Đạo (near Thượng Tứ gate): 2 elderly people trapped, water 0.7–0.8 m and rising. Trucks cannot get in.",
  },
  "kim-long": {
    message:
      "Hello, my house is in lane 20 Kim Long, the water is up to our chests, my mother fell and her leg is bleeding, we have two small children, we need a boat urgently.",
    summary: "Elderly woman with a bleeding leg and 2 small children; water chest-deep and rising; boat needed urgently.",
    dispatch:
      "URGENT: Lane 20 Kim Long — 4 people (an elderly woman with a bleeding leg, 2 small children) trapped, water 1.1–1.4 m and flowing. Send a boat and first aid.",
  },
  "bach-dang": {
    message: "A family of five on the upper floor, with a 6-month-old baby and grandmother. We have run out of drinking water.",
    summary: "5 people on an upper floor, including a 6-month-old and an elderly woman; out of drinking water.",
    dispatch:
      "Bạch Đằng (Gia Hội): 5 people on an upper floor incl. a 6-month-old and an elderly woman, water 0.9–1.1 m. Bring drinking water, milk and food; a boat is needed.",
  },
  "le-duan": {
    message: "Lê Duẩn by Ngăn gate is flooded above the wheels, many scooters have stalled, and the water is still rising.",
    summary: "Lê Duẩn at Ngăn gate flooded about 0.4 m; scooters stalling; water rising.",
    dispatch: "Lê Duẩn (Ngăn gate) flooded 0.35–0.5 m and rising. Scooters and cars cannot pass; rescue trucks can.",
  },
  "ba-trieu": {
    message: "Water up to the wheel hubs; scooters can still pass slowly.",
    summary: "Bà Triệu flooded about 0.2 m; scooters can still pass slowly.",
    dispatch: "Bà Triệu flooded 0.1–0.3 m, not rising. Rescue trucks can pass.",
  },
  "phan-dinh-phung": {
    message:
      "My wife is nine months pregnant and has started having contractions. Our house is in lane 63 Phan Đình Phùng, the water is thigh-deep and the scooter can't get through. Please help take her to the hospital.",
    summary: "Woman 9 months pregnant in labour; needs transport to hospital; water thigh-deep.",
    dispatch:
      "URGENT: Lane 63 Phan Đình Phùng — woman 9 months pregnant in labour, needs transport to Huế Central Hospital. Water 0.55–0.7 m: send a rescue truck or a boat.",
  },
  "nguyen-hue": {
    message: "Nguyễn Huệ near the Lý Thường Kiệt junction has shallow water; scooters can still get through.",
    summary: "Nguyễn Huệ ankle-deep; scooters still passing.",
    dispatch: "Nguyễn Huệ (Lý Thường Kiệt junction) flooded 0.05–0.2 m, passable.",
  },
  "kiet-ba-trieu-night": {
    message: "Someone is calling for help in lane 116 Bà Triệu; it is too dark to see anything; there are 2 people in the house next door.",
    summary: "Calls for help in lane 116 Bà Triệu; the photo is too dark to measure the water.",
    dispatch: "Lane 116 Bà Triệu: 2 people calling for help, water depth unknown (photo too dark). Needs checking.",
  },
  "dinh-tien-hoang": {
    message: "My husband is paralysed and bedridden; the water in the house is almost up to the bed and rising fast.",
    summary: "Paralysed, bedridden man; water almost at the bed and rising fast.",
    dispatch:
      "Đinh Tiên Hoàng (Citadel): 1 paralysed person needs a stretcher, water 0.8–1.0 m and rising fast. Send a boat and 2 carriers.",
  },
};
