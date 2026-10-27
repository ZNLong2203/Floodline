import { band, BAND_LABEL, pct, REPORT_STATUS, STATUS } from "../lib/format";
import type { ReportStatus, SegmentStatus } from "../lib/types";

/** Passability with an icon and colour, so it reads without colour vision too. */
export function StatusPill({
  status,
  label,
  lang = "en",
  size = "md",
}: {
  status: SegmentStatus;
  label?: string;
  lang?: "en" | "vi";
  size?: "sm" | "md";
}) {
  const s = STATUS[status];
  return (
    <span className={`pill pill--${s.tone} pill--${size}`}>
      <StatusGlyph status={status} />
      <span>{label ?? (lang === "vi" ? s.vi : s.en)}</span>
    </span>
  );
}

export function StatusGlyph({ status, size = 14 }: { status: SegmentStatus; size?: number }) {
  const tone = STATUS[status].tone;
  const d =
    status === "passable"
      ? "M4.5 8.3 7 10.8l4.6-5.2"
      : status === "risky"
        ? "M8 4.2v4.6M8 11.4v.2"
        : status === "impassable"
          ? "M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6"
          : "M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.3M8 11.6v.1";
  return (
    <svg className={`glyph glyph--${tone}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {status === "risky" ? (
        <path d="M8 1.6 15 14H1L8 1.6Z" className="glyph__bg" />
      ) : status === "impassable" ? (
        <rect x="1.2" y="1.2" width="13.6" height="13.6" rx="3" className="glyph__bg" />
      ) : (
        <circle cx="8" cy="8" r="7" className="glyph__bg" />
      )}
      <path
        d={d}
        transform={status === "risky" ? "translate(0 1.3)" : undefined}
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PriorityBadge({ priority, size = "md" }: { priority: number | null | undefined; size?: "sm" | "md" | "lg" }) {
  const b = band(priority);
  return (
    <span
      className={`prio prio--${b} prio--${size}`}
      title={`Priority ${priority ?? "–"} of 100 · ${BAND_LABEL[b]}`}
      aria-label={`Priority ${priority ?? "unknown"} of 100, ${BAND_LABEL[b]}`}
    >
      <span className="prio__p">P</span>
      {priority ?? "–"}
    </span>
  );
}

export function ReportStatusTag({ status }: { status: ReportStatus }) {
  return <span className={`rstatus rstatus--${status}`}>{REPORT_STATUS[status].en}</span>;
}

export function Probability({ p }: { p: number }) {
  return (
    <span className="prob" title={`P(depth > limit) = ${(p * 100).toFixed(1)}%`}>
      <span className="prob__bar">
        <span className="prob__fill" style={{ width: `${Math.max(2, p * 100)}%` }} />
      </span>
      <span className="prob__num">{pct(p)}</span>
    </span>
  );
}
