import { type Key, langCode, type Vars } from "./i18n";
import type { Passability, Report, ReportStatus, SegmentStatus } from "./types";

export function m(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "–";
  return `${v.toFixed(digits)} m`;
}

export function range(lo: number | null | undefined, hi: number | null | undefined): string {
  if (lo == null || hi == null) return "–";
  return `${lo.toFixed(2)}–${hi.toFixed(2)} m`;
}

export function pct(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "–";
  if (p < 0.01) return "<1%";
  if (p > 0.99) return ">99%";
  return `${Math.round(p * 100)}%`;
}

export function distance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km`;
  return `${Math.round(metres / 10) * 10} m`;
}

export function age(at: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - at);
  if (s < 45) return "just now";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  if (h < 24) return rem ? `${h} h ${rem} min ago` : `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** Relative age in the UI language. */
export function ageT(at: number, now: number, t: (k: Key, v?: Vars) => string): string {
  const s = Math.max(0, now - at);
  if (s < 45) return t("age.now");
  const min = Math.round(s / 60);
  if (min < 60) return t("age.min", { n: min });
  const h = Math.floor(min / 60);
  const rem = min % 60;
  if (h < 24) return rem ? t("age.hmin", { h, m: rem }) : t("age.h", { h });
  return t("age.d", { n: Math.floor(h / 24) });
}

/** Translate a triage reason such as "vulnerable: elderly, sick" or "depth 1.3 m". */
export function reasonT(reason: string, t: (k: Key, v?: Vars) => string): string {
  const r = reason.trim();
  if (r === "injury or medical need") return t("reason.injury");
  if (r === "trapped") return t("reason.trapped");
  if (r === "water rising") return t("reason.rising");
  let m = /^vulnerable:\s*(.+)$/.exec(r);
  if (m) return t("reason.vulnerable", { list: m[1].split(/,\s*/).map((v) => vulT(v, t)).join(", ") });
  m = /^depth\s+([\d.]+)\s*m$/.exec(r);
  if (m) return t("reason.depth", { m: m[1] });
  m = /^(\d+)\s+people$/.exec(r);
  if (m) return t("reason.people", { n: m[1] });
  return r;
}

export function vulT(v: string, t: (k: Key, vars?: Vars) => string): string {
  const k = `vul.${v}` as Key;
  const s = t(k);
  return s === k ? v : s;
}

export function needT(v: string, t: (k: Key, vars?: Vars) => string): string {
  const k = `need.${v}` as Key;
  const s = t(k);
  return s === k ? v : s;
}

/** A photo-quality warning ("photo: motion blur", "no water found in the photo") in the UI language. */
export function flagT(w: string, t: (k: Key, vars?: Vars) => string): string {
  if (/no water found/i.test(w)) return t("flag.no_water");
  const name = w.replace(/^photo:\s*/, "").trim().replace(/\s+/g, "_");
  const k = `flag.${name}` as Key;
  const s = t(k);
  return s === k ? capitalise(w.replace(/^photo:\s*/, "").replace(/_/g, " ")) : s;
}

export function clock(at: number): string {
  return new Date(at * 1000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export const STATUS: Record<
  SegmentStatus,
  { en: string; vi: string; viShout: string; icon: string; tone: "ok" | "warn" | "bad" | "none" }
> = {
  passable: { en: "Passable", vi: "Qua được", viShout: "QUA ĐƯỢC", icon: "✓", tone: "ok" },
  risky: { en: "Risky", vi: "Rủi ro", viShout: "RỦI RO", icon: "!", tone: "warn" },
  impassable: { en: "Impassable", vi: "Không qua được", viShout: "KHÔNG qua được", icon: "✕", tone: "bad" },
  unknown: { en: "No data", vi: "Chưa có dữ liệu", viShout: "CHƯA RÕ", icon: "?", tone: "none" },
};

export const REPORT_STATUS: Record<ReportStatus, { en: string; vi: string }> = {
  new: { en: "New", vi: "Mới" },
  acknowledged: { en: "Acknowledged", vi: "Đã nhận" },
  dispatched: { en: "Dispatched", vi: "Đã điều đội" },
  closed: { en: "Closed", vi: "Đã đóng" },
};

export type PriorityBand = "critical" | "urgent" | "routine" | "none";

export function band(priority: number | null | undefined): PriorityBand {
  if (priority == null) return "none";
  if (priority >= 60) return "critical";
  if (priority >= 30) return "urgent";
  return "routine";
}

export const BAND_LABEL: Record<PriorityBand, string> = {
  critical: "Critical",
  urgent: "Urgent",
  routine: "Routine",
  none: "Untriaged",
};

export function priorityOf(r: Report): number {
  return r.triage?.priority ?? 0;
}

export function isClip(r: Report): boolean {
  return r.analysis?.kind === "clip" || Boolean(r.video_url);
}

/** The resident's language as a short code ("vi"), from the triage facts. */
export function reportLang(r: Report): string {
  const f = r.triage?.facts;
  if (f?.language) return langCode(f.language);
  if (f?.summary_vi || f?.dispatch_vi) return "vi";
  return "";
}

/** The summary in the reader's language: local text when they share the resident's language, else English. */
export function summaryOf(r: Report, lang: string = "en"): string {
  const f = r.triage?.facts;
  const local = f?.summary_local || f?.summary_vi || r.analysis?.perception?.summary_vi;
  const english = f?.summary_en;
  const same = lang === reportLang(r) || (!reportLang(r) && lang !== "en");
  return (same ? local || english : english || local) || r.note || "–";
}

/** Dispatch drafts, English first unless the reader shares the resident's language. */
export function dispatchDrafts(r: Report, lang: string = "en"): { lang: string; text: string }[] {
  const f = r.triage?.facts;
  if (!f) return [];
  const local = f.dispatch_local || f.dispatch_vi;
  const out: { lang: string; text: string }[] = [];
  if (f.dispatch_en) out.push({ lang: "en", text: f.dispatch_en });
  if (local && local !== f.dispatch_en) out.push({ lang: reportLang(r) || "vi", text: local });
  return lang !== "en" && lang === reportLang(r) ? out.reverse() : out;
}

export function verdictFor(r: Report, vehicle: string): Passability | null {
  return r.analysis?.verdicts?.find((v) => v.vehicle === vehicle)?.status ?? null;
}

/** Sort for the triage queue: open before closed, then priority, then newest. */
export function queueOrder(a: Report, b: Report): number {
  const ca = a.status === "closed" ? 1 : 0;
  const cb = b.status === "closed" ? 1 : 0;
  if (ca !== cb) return ca - cb;
  const dp = priorityOf(b) - priorityOf(a);
  if (dp !== 0) return dp;
  return b.at - a.at;
}

export type ReadingKind =
  | "scale"
  | "landmark"
  | "fraction"
  | "closeup-landmark"
  | "closeup-fraction"
  | "spark"
  | "report"
  | "other";

export interface SourceParts {
  kind: ReadingKind;
  object: string | null;
  index: number | null;
  /** "scale:scooter#3@clip" (a median over the clip's frames) or "spark:video". */
  clip: boolean;
  raw: string;
}

/** "scale:scooter#2" -> { kind: "scale", object: "scooter", index: 2 } */
export function parseSource(source: string): SourceParts {
  const [head, rest = ""] = source.split(":", 2);
  const kinds = ["scale", "landmark", "fraction", "closeup-landmark", "closeup-fraction", "spark", "report"] as const;
  const kind = (kinds as readonly string[]).includes(head) ? (head as SourceParts["kind"]) : "other";
  const clip = /@clip$/i.test(rest) || source === "spark:video";
  const tag = rest.replace(/@clip$/i, "");
  const match = /^([a-z_]+)#(\d+)$/i.exec(tag);
  return {
    kind,
    object: match ? match[1] : kind === "spark" ? null : tag || null,
    index: match ? Number(match[2]) : null,
    clip,
    raw: source,
  };
}

export const KIND_LABEL: Record<ReadingKind, { en: string; hint: string }> = {
  scale: { en: "Scale", hint: "Pixels to metres from the object's known size" },
  landmark: { en: "Landmark", hint: "The part of the object the water reaches" },
  fraction: { en: "Fraction", hint: "Share of the object's height under water" },
  "closeup-landmark": {
    en: "Close-up landmark",
    hint: "Close-up look: Spark re-examines an enlarged crop of the object and names the part the water reaches",
  },
  "closeup-fraction": {
    en: "Close-up fraction",
    hint: "Close-up look: Spark re-examines an enlarged crop of the object and judges how much is under water",
  },
  spark: { en: "Muse Spark", hint: "The model's own overall range, as a sanity check" },
  report: { en: "Report", hint: "A nearby report, widened by distance and age" },
  other: { en: "Other", hint: "" },
};

export const OBJECT_VI: Record<string, string> = {
  scooter: "xe máy",
  car: "ô tô",
  person: "người",
  door: "cửa",
  bicycle: "xe đạp",
  bus: "xe buýt",
  truck: "xe tải",
};

export function humanise(s: string): string {
  return s.replace(/_/g, " ");
}

export function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Same palette as floodline/imaging.py, so evidence rows match the overlay colours. */
export const OVERLAY_PALETTE = [
  "rgb(0,168,232)",
  "rgb(255,170,0)",
  "rgb(230,57,70)",
  "rgb(106,190,48)",
  "rgb(155,89,182)",
  "rgb(255,99,196)",
  "rgb(26,188,156)",
  "rgb(241,196,15)",
];

export const VULNERABLE_VI: Record<string, string> = {
  elderly: "người già",
  child: "trẻ em",
  infant: "trẻ sơ sinh",
  pregnant: "phụ nữ mang thai",
  disabled: "người khuyết tật",
  sick: "người bệnh",
};

export const NEEDS_VI: Record<string, string> = {
  evacuation: "sơ tán",
  boat: "thuyền",
  medical: "y tế",
  food: "lương thực",
  water: "nước uống",
  power: "điện",
  info: "thông tin",
};

/** Label for a reading row, short enough for the evidence label column. */
export function kindShort(kind: ReadingKind): string {
  return kind === "closeup-landmark" || kind === "closeup-fraction" ? "Close-up" : KIND_LABEL[kind].en;
}

export interface ParsedNote {
  /** The note without the calibration and confidence suffixes. */
  text: string;
  /** The catalog range before calibration, from "; raw 0.44-0.49 m". */
  raw: [number, number] | null;
  /** Close-up readings end with "(high)", "(medium)" or "(low)". */
  confidence: string | null;
}

export function parseNote(note: string): ParsedNote {
  let text = note ?? "";
  let raw: [number, number] | null = null;
  const r = /;?\s*raw\s+(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)\s*m\s*$/i.exec(text);
  if (r) {
    raw = [Number(r[1]), Number(r[2])];
    text = text.slice(0, r.index).trim();
  }
  let confidence: string | null = null;
  const c = /\s*\((low|medium|high)\)\s*$/i.exec(text);
  if (c) {
    confidence = c[1].toLowerCase();
    text = text.slice(0, c.index).trim();
  }
  return { text, raw, confidence };
}
