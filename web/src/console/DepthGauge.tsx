import { STATUS } from "../lib/format";
import type { Estimate, Verdict } from "../lib/types";

const H = 250;
const TOP = 12;
const BOTTOM = H - 20;
const BAR_X = 40;
const BAR_W = 26;
const SIL_X = 74;
const LINE_END = 112;
const LABEL_X = 118;

// A standing adult, 170 units tall and ~44 wide, feet at y = 0.
const PERSON =
  "M16 -148h12a8 8 0 0 1 8 8l3 46h-6l-3-38h-1v132h-8l-1-76h-2l-1 76h-8v-132h-1l-3 38h-6l3-46a8 8 0 0 1 8-8Z";

export function DepthGauge({
  estimate,
  verdicts,
  width = 262,
}: {
  estimate: Estimate | null;
  verdicts: Verdict[];
  width?: number;
}) {
  const W = width;
  const max = Math.max(2, Math.ceil(((estimate?.high_m ?? 0) + 0.05) * 2) / 2);
  const pxPerM = (BOTTOM - TOP) / max;
  const y = (m: number) => BOTTOM - Math.min(m, max) * pxPerM;
  const ticks: number[] = [];
  for (let m = 0; m <= max + 1e-9; m += 0.5) ticks.push(Math.round(m * 10) / 10);
  const minor: number[] = [];
  for (let m = 0.1; m < max; m += 0.1) minor.push(m);

  // Lay out vehicle-limit labels top to bottom without overlaps; merge identical limits.
  const groups = new Map<number, Verdict[]>();
  for (const v of verdicts) {
    const k = Math.round(v.limit_m * 100) / 100;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  const labels = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([limit, vs]) => ({ limit, vs, ly: y(limit), y: y(limit) }));
  const GAP = 16;
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + GAP);
  for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - GAP);
  const k = pxPerM / 100;

  return (
    <svg
      className="gauge"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={
        estimate
          ? `Depth ${estimate.low_m.toFixed(2)} to ${estimate.high_m.toFixed(2)} metres, mean ${estimate.mean_m.toFixed(2)}`
          : "No depth reading"
      }
    >
      <defs>
        <linearGradient id="gw" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--water)" stopOpacity=".28" />
          <stop offset="1" stopColor="var(--water)" stopOpacity=".12" />
        </linearGradient>
        <pattern id="ghatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="var(--water)" fillOpacity=".55" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#fff" strokeOpacity=".35" strokeWidth="2" />
        </pattern>
      </defs>

      {/* axis */}
      {ticks.map((t) => (
        <g key={t}>
          <text x={BAR_X - 7} y={y(t) + 4} className="gauge__tick" textAnchor="end">
            {t === 0 ? "0" : t === ticks[ticks.length - 1] ? `${t.toFixed(1)} m` : t.toFixed(1)}
          </text>
          <line x1={BAR_X - 4} x2={BAR_X} y1={y(t)} y2={y(t)} className="gauge__tickline" />
        </g>
      ))}

      {/* bar track and a human for scale */}
      <rect x={BAR_X} y={TOP} width={BAR_W} height={BOTTOM - TOP} rx="5" className="gauge__track" />
      {minor.map((m) => (
        <line key={m} x1={BAR_X} x2={BAR_X + 5} y1={y(m)} y2={y(m)} className="gauge__minor" />
      ))}
      <g transform={`translate(${SIL_X} ${BOTTOM}) scale(${k})`} className="gauge__person">
        <path d={PERSON} />
        <circle cx="22" cy="-160" r="10" />
      </g>

      {estimate && (
        <g>
          <rect x={BAR_X} y={y(estimate.mean_m)} width={LINE_END - BAR_X - 6} height={BOTTOM - y(estimate.mean_m)} fill="url(#gw)" />
          <line x1={BAR_X} x2={LINE_END - 6} y1={y(estimate.mean_m)} y2={y(estimate.mean_m)} className="gauge__surface" />
          <rect
            x={BAR_X + 3}
            y={y(estimate.high_m)}
            width={BAR_W - 6}
            height={Math.max(3, y(estimate.low_m) - y(estimate.high_m))}
            rx="3"
            fill="url(#ghatch)"
            className="gauge__interval"
          />
          <line x1={BAR_X - 2} x2={BAR_X + BAR_W + 2} y1={y(estimate.mean_m)} y2={y(estimate.mean_m)} className="gauge__mean" />
        </g>
      )}

      {estimate && !labels.some((l) => Math.abs(l.y - y(estimate.mean_m)) < 15) && (
        <g className="gauge__callout">
          <line x1={LINE_END - 6} x2={LABEL_X + 2} y1={y(estimate.mean_m)} y2={y(estimate.mean_m)} />
          <text x={LABEL_X + 6} y={y(estimate.mean_m) + 4}>
            water surface <tspan className="num">{estimate.mean_m.toFixed(2)} m</tspan>
          </text>
        </g>
      )}

      {/* vehicle limits */}
      {labels.map((l) => {
        const worst = l.vs.reduce<Verdict["status"]>(
          (acc, v) => (v.status === "impassable" || acc === "impassable" ? "impassable" : v.status === "risky" || acc === "risky" ? "risky" : "passable"),
          "passable",
        );
        const tone = STATUS[worst].tone;
        return (
          <g key={l.limit} className={`gauge__limit tone--${tone}`}>
            <line x1={BAR_X - 3} x2={LINE_END} y1={l.ly} y2={l.ly} className="gauge__limitline" />
            <path d={`M${LINE_END} ${l.ly} L${LABEL_X - 2} ${l.y}`} className="gauge__leader" />
            <GlyphMini status={worst} x={LABEL_X + 5} y={l.y} />
            <text x={LABEL_X + 14} y={l.y + 4} className="gauge__label">
              {l.vs.map((v) => v.name_vi).join(" · ")}
              <tspan className="gauge__labelnum"> {l.limit.toFixed(2)} m</tspan>
            </text>
          </g>
        );
      })}

      {!estimate && (
        <text x={BAR_X + BAR_W / 2} y={(TOP + BOTTOM) / 2} className="gauge__none" textAnchor="middle" transform={`rotate(-90 ${BAR_X + BAR_W / 2} ${(TOP + BOTTOM) / 2})`}>
          no reading
        </text>
      )}
    </svg>
  );
}

function GlyphMini({ status, x, y }: { status: Verdict["status"]; x: number; y: number }) {
  if (status === "passable")
    return (
      <g transform={`translate(${x} ${y})`}>
        <circle r="5.6" className="glyph__bg" />
        <path d="M-2.6 0.2 -0.8 2 2.8 -1.8" className="glyph__mark" />
      </g>
    );
  if (status === "risky")
    return (
      <g transform={`translate(${x} ${y})`}>
        <path d="M0 -6 6 4.8H-6Z" className="glyph__bg" />
        <path d="M0 -2.4v2.8M0 2.6v.1" className="glyph__mark" />
      </g>
    );
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-5.4" y="-5.4" width="10.8" height="10.8" rx="2.2" className="glyph__bg" />
      <path d="M-2.3 -2.3 2.3 2.3M2.3 -2.3 -2.3 2.3" className="glyph__mark" />
    </g>
  );
}
