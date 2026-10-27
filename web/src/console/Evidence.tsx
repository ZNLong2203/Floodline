import type { CSSProperties } from "react";
import {
  capitalise,
  humanise,
  KIND_LABEL,
  OBJECT_VI,
  OVERLAY_PALETTE,
  parseSource,
} from "../lib/format";
import type { Analysis, Reading } from "../lib/types";

type Fate = "used" | "rejected" | "none";

const same = (a: Reading, b: Reading) =>
  a.source === b.source && Math.abs(a.low_m - b.low_m) < 1e-6 && Math.abs(a.high_m - b.high_m) < 1e-6;

function detail(r: Reading): string {
  const p = parseSource(r.source);
  switch (p.kind) {
    case "landmark":
      return `water at the ${humanise(r.note)}`;
    case "fraction": {
      const f = Number(r.note);
      return Number.isFinite(f) ? `${Math.round(f * 100)}% of height submerged` : r.note;
    }
    case "scale":
      return r.note || "visible height vs known size";
    case "spark":
      return "whole-photo judgement";
    default:
      return r.note;
  }
}

interface Group {
  key: string;
  title: string;
  meta: string;
  colour: string | null;
  readings: Reading[];
  muted?: string;
}

export function Evidence({ analysis }: { analysis: Analysis }) {
  const est = analysis.estimate;
  const fate = (r: Reading): Fate =>
    est?.rejected?.some((x) => same(x, r)) ? "rejected" : est?.used?.some((x) => same(x, r)) ? "used" : "none";

  const groups: Group[] = [];
  const claimed: Reading[] = [];
  for (const o of [...(analysis.objects ?? [])].sort((a, b) => a.index - b.index)) {
    claimed.push(...o.readings);
    const meta = [
      o.orientation && o.orientation !== "unclear" ? humanise(o.orientation) : null,
      o.landmark && o.landmark !== "unclear" ? `water at ${humanise(o.landmark)}` : null,
      o.sam_confidence != null ? `SAM ${o.sam_confidence.toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    groups.push({
      key: `o${o.index}`,
      title: `${capitalise(o.label)}${OBJECT_VI[o.label] ? ` · ${OBJECT_VI[o.label]}` : ""}`,
      meta,
      colour: OVERLAY_PALETTE[o.index % OVERLAY_PALETTE.length],
      readings: o.readings,
      muted: !o.standing_in_water ? "not standing in the water, so not used" : !o.readings.length ? "no usable reading" : undefined,
    });
  }
  const loose = [...(est?.used ?? []), ...(est?.rejected ?? [])].filter((r) => !claimed.some((c) => same(c, r)));
  if (loose.length)
    groups.push({
      key: "photo",
      title: "Whole photo",
      meta: "Muse Spark's own estimate",
      colour: null,
      readings: loose,
    });

  const all = groups.flatMap((g) => g.readings);
  const max = Math.max(2, Math.ceil(Math.max(0, ...all.map((r) => r.high_m), est?.high_m ?? 0) * 2) / 2);
  const ticks: number[] = [];
  for (let m = 0; m <= max + 1e-9; m += 0.5) ticks.push(Math.round(m * 10) / 10);
  const pos = (m: number) => `${(Math.min(Math.max(m, 0), max) / max) * 100}%`;
  const rejectedCount = all.filter((r) => fate(r) === "rejected").length;

  if (!all.length) {
    return (
      <div className="ev ev--empty">
        No reading could be made from this photo. Muse Spark found no reference object standing in the water
        {analysis.warnings?.length ? ` (${analysis.warnings.join("; ")})` : ""}.
      </div>
    );
  }

  return (
    <div className="ev" style={{ "--max": max } as CSSProperties}>
      <div className="ev__legend">
        {(["scale", "landmark", "fraction", "spark"] as const).map((k) => (
          <span key={k} className={`ev__key kind--${k}`} title={KIND_LABEL[k].hint}>
            <i />
            {KIND_LABEL[k].en}
          </span>
        ))}
        <span className="ev__key ev__key--rej">
          <i />
          Rejected
        </span>
      </div>

      <div className="ev__grid">
        <div className="ev__axis" aria-hidden="true">
          <div className="ev__label" />
          <div className="ev__track ev__track--axis">
            {ticks.map((t) => (
              <span key={t} className="ev__tick" style={{ left: pos(t) }}>
                {t === 0 ? "0" : t.toFixed(1)}
                {t === max ? " m" : ""}
              </span>
            ))}
          </div>
        </div>

        <div className="ev__rows">
          {est && (
            <div className="ev__band" aria-hidden="true">
              <div className="ev__bandfill" style={{ left: pos(est.low_m), width: `calc(${pos(est.high_m)} - ${pos(est.low_m)})` }} />
              <div className="ev__bandmean" style={{ left: pos(est.mean_m) }} />
            </div>
          )}

          {groups.map((g) => (
            <div key={g.key} className="ev__group">
              <div className="ev__ghead">
                <div className="ev__label">
                  {g.colour ? (
                    <span className="ev__swatch" style={{ background: g.colour }}>
                      {Number(g.key.slice(1)) + 1}
                    </span>
                  ) : (
                    <span className="ev__swatch ev__swatch--spark">✦</span>
                  )}
                  <span className="ev__gtitle">{g.title}</span>
                </div>
                <div className="ev__gmeta">{g.muted ?? g.meta}</div>
              </div>
              {g.readings.map((r) => {
                const p = parseSource(r.source);
                const f = fate(r);
                const mid = (r.low_m + r.high_m) / 2;
                return (
                  <div
                    key={r.source + r.low_m}
                    className={`ev__row kind--${p.kind} ${f === "rejected" ? "is-rejected" : ""}`}
                    title={`${r.source}: ${r.low_m.toFixed(2)}–${r.high_m.toFixed(2)} m${r.note ? ` (${r.note})` : ""}`}
                  >
                    <div className="ev__label">
                      <span className="ev__kind">{KIND_LABEL[p.kind].en}</span>
                      <span className="ev__detail">{detail(r)}</span>
                      <span className="ev__nums num">
                        {r.low_m.toFixed(2)}–{r.high_m.toFixed(2)}
                      </span>
                      {f === "rejected" && <span className="ev__rejtag">rejected as outlier</span>}
                    </div>
                    <div className="ev__track">
                      <span
                        className="ev__bar"
                        style={{ left: pos(r.low_m), width: `max(4px, calc(${pos(r.high_m)} - ${pos(r.low_m)}))` }}
                      />
                      <span className="ev__dot" style={{ left: pos(mid) }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {est && (
            <div className="ev__row ev__row--consensus">
              <div className="ev__label">
                <span className="ev__kind">Consensus</span>
                <span className="ev__detail">
                  {est.used.length} used{rejectedCount ? `, ${rejectedCount} rejected` : ""}
                </span>
                <span className="ev__nums num">
                  {est.low_m.toFixed(2)}–{est.high_m.toFixed(2)}
                </span>
              </div>
              <div className="ev__track">
                <span className="ev__bar" style={{ left: pos(est.low_m), width: `max(4px, calc(${pos(est.high_m)} - ${pos(est.low_m)}))` }} />
                <span className="ev__dot" style={{ left: pos(est.mean_m) }} />
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="ev__foot">
        Outliers are dropped by median absolute deviation; the rest are combined by inverse variance, and disagreement between
        methods widens the interval instead of being averaged away.
      </p>
    </div>
  );
}
