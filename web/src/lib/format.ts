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

export function summaryOf(r: Report): string {
  return (
    r.triage?.facts?.summary_vi ||
    r.analysis?.perception?.summary_vi ||
    r.note ||
    "Chưa có mô tả."
  );
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

export interface SourceParts {
  kind: "scale" | "landmark" | "fraction" | "spark" | "report" | "other";
  object: string | null;
  index: number | null;
  raw: string;
}

/** "scale:scooter#2" -> { kind: "scale", object: "scooter", index: 2 } */
export function parseSource(source: string): SourceParts {
  const [head, rest = ""] = source.split(":", 2);
  const kinds = ["scale", "landmark", "fraction", "spark", "report"] as const;
  const kind = (kinds as readonly string[]).includes(head) ? (head as SourceParts["kind"]) : "other";
  const match = /^([a-z_]+)#(\d+)$/i.exec(rest);
  return {
    kind,
    object: match ? match[1] : kind === "spark" ? null : rest || null,
    index: match ? Number(match[2]) : null,
    raw: source,
  };
}

export const KIND_LABEL: Record<SourceParts["kind"], { en: string; hint: string }> = {
  scale: { en: "Scale", hint: "Pixels to metres from the object's known size" },
  landmark: { en: "Landmark", hint: "The part of the object the water reaches" },
  fraction: { en: "Fraction", hint: "Share of the object's height under water" },
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
