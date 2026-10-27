import type { CSSProperties } from "react";
import {
  capitalise,
  humanise,
  KIND_LABEL,
  kindShort,
  OBJECT_VI,
  OVERLAY_PALETTE,
  parseNote,
  parseSource,
  type ReadingKind,
} from "../lib/format";
import type { Analysis, Reading } from "../lib/types";

type Fate = "used" | "rejected" | "none";

const same = (a: Reading, b: Reading) =>
  a.source === b.source && Math.abs(a.low_m - b.low_m) < 1e-6 && Math.abs(a.high_m - b.high_m) < 1e-6;

const centre = (r: Reading) => r.mean_m ?? (r.low_m + r.high_m) / 2;

function detail(r: Reading): string {
  const p = parseSource(r.source);
  const n = parseNote(r.note);
  const conf = n.confidence ? ` · ${n.confidence} confidence` : "";
  switch (p.kind) {
    case "landmark":
      return `water at the ${humanise(n.text)}`;
    case "closeup-landmark":
      return `water at the ${humanise(n.text)}${conf}`;
    case "fraction":
    case "closeup-fraction": {
      const f = Number(n.text);
      const what = Number.isFinite(f) ? `${Math.round(f * 100)}% of height submerged` : n.text;
      return p.kind === "fraction" ? what : `${what}${conf}`;
    }
    case "scale":
      return n.text || "visible height vs known size";
    case "spark":
      return p.clip ? "watched the whole clip" : "whole-photo judgement";
    default:
      return n.text;
  }
}

interface Group {
  key: string;
  index: number | null;
  title: string;
  meta: string;
  colour: string | null;
  readings: Reading[];
  muted?: string;
}

const LEGEND_ORDER: ReadingKind[] = ["scale", "landmark", "fraction", "closeup-landmark", "closeup-fraction", "spark"];

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
      o.frames_tracked != null ? `tracked ${o.frames_tracked} frames` : null,
      o.frames_measured ? `waterline in ${o.frames_measured}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    groups.push({
      key: `o${o.index}`,
      index: o.index,
      title: `${capitalise(o.label)}${OBJECT_VI[o.label] ? ` · ${OBJECT_VI[o.label]}` : ""}`,
      meta,
      colour: OVERLAY_PALETTE[o.index % OVERLAY_PALETTE.length],
      readings: o.readings,
      muted:
        o.standing_in_water === false
          ? "not standing in the water, so not used"
          : !o.readings.length
            ? "no usable reading"
            : undefined,
    });
  }
  const loose = [...(est?.used ?? []), ...(est?.rejected ?? [])].filter((r) => !claimed.some((c) => same(c, r)));
  if (loose.length)
    groups.push({
      key: "photo",
      index: null,
      title: analysis.kind === "clip" ? "Whole clip" : "Whole photo",
      meta: analysis.kind === "clip" ? "Muse Spark watched the clip" : "Muse Spark's own estimate",
      colour: null,
      readings: loose,
    });

  const all = groups.flatMap((g) => g.readings);
  const raws = all.map((r) => parseNote(r.note).raw).filter((x): x is [number, number] => x !== null);
  const calibrated = Boolean(analysis.calibration) || raws.length > 0;
  // A shared 0–2 m axis; it only grows when the consensus itself goes deeper. Wider
  // readings are clipped at the edge with an arrow rather than squashing every other bar.
  const top = est ? est.high_m : Math.max(0, ...all.map((r) => r.mean_m ?? (r.low_m + r.high_m) / 2));
  const max = Math.min(5, Math.max(2, Math.ceil(top * 2) / 2));
  const ticks: number[] = [];
  for (let m = 0; m <= max + 1e-9; m += 0.5) ticks.push(Math.round(m * 10) / 10);
  const pos = (m: number) => `${(Math.min(Math.max(m, 0), max) / max) * 100}%`;
  const span = (lo: number, hi: number) => `max(4px, calc(${pos(hi)} - ${pos(lo)}))`;
  const rejectedCount = all.filter((r) => fate(r) === "rejected").length;
  const kindsPresent = new Set(all.map((r) => parseSource(r.source).kind));

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
        {LEGEND_ORDER.filter((k) => kindsPresent.has(k)).map((k) => (
          <span key={k} className={`ev__key kind--${k}`} title={KIND_LABEL[k].hint}>
            <i />
            {KIND_LABEL[k].en}
          </span>
        ))}
        {raws.length > 0 && (
          <span className="ev__key ev__key--raw" title="The catalog's range for the reading, before calibration">
            <i />
            Before calibration
          </span>
        )}
        {rejectedCount > 0 && (
          <span className="ev__key ev__key--rej">
            <i />
            Rejected
          </span>
        )}
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
                      {(g.index ?? 0) + 1}
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
                const n = parseNote(r.note);
                const f = fate(r);
                const closeup = p.kind === "closeup-landmark" || p.kind === "closeup-fraction";
                const tip = [
                  `${KIND_LABEL[p.kind].en}: ${r.low_m.toFixed(2)}–${r.high_m.toFixed(2)} m`,
                  n.raw ? `before calibration ${n.raw[0].toFixed(2)}–${n.raw[1].toFixed(2)} m` : null,
                  f === "rejected" ? "rejected as outlier" : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div
                    key={r.source + r.low_m}
                    className={`ev__row kind--${p.kind} ${closeup ? "is-closeup" : ""} ${f === "rejected" ? "is-rejected" : ""}`}
                    title={tip}
                  >
                    <div className="ev__label">
                      <span className="ev__kind" title={KIND_LABEL[p.kind].hint}>
                        {closeup && <span aria-hidden="true">⌕ </span>}
                        {kindShort(p.kind)}
                        {p.clip && p.kind !== "spark" && <span className="ev__cliptag">clip</span>}
                      </span>
                      <span className="ev__nums num">
                        {r.low_m.toFixed(2)}–{r.high_m.toFixed(2)}
                      </span>
                      <span className="ev__detail">{detail(r)}</span>
                      {f === "rejected" && <span className="ev__rejtag">rejected as outlier</span>}
                    </div>
                    <div className="ev__track">
                      {n.raw && (
                        <span
                          className="ev__raw"
                          style={{ left: pos(n.raw[0]), width: span(n.raw[0], n.raw[1]) }}
                          title={`Before calibration: ${n.raw[0].toFixed(2)}–${n.raw[1].toFixed(2)} m`}
                        />
                      )}
                      <span
                        className={`ev__bar ${r.high_m > max ? "is-clipped" : ""}`}
                        style={{ left: pos(r.low_m), width: span(r.low_m, r.high_m) }}
                      />
                      {r.high_m > max && <span className="ev__more" aria-hidden="true" title={`continues to ${r.high_m.toFixed(2)} m`} />}
                      <span className="ev__dot" style={{ left: pos(centre(r)) }} />
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
                <span className="ev__nums num">
                  {est.low_m.toFixed(2)}–{est.high_m.toFixed(2)}
                </span>
                <span className="ev__detail">
                  {est.used.length} used{rejectedCount ? `, ${rejectedCount} rejected` : ""}
                </span>
              </div>
              <div className="ev__track">
                <span className="ev__bar" style={{ left: pos(est.low_m), width: span(est.low_m, est.high_m) }} />
                <span className="ev__dot" style={{ left: pos(est.mean_m) }} />
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="ev__foot">
        Outliers are dropped by median absolute deviation; the rest are combined by inverse variance, and disagreement between
        methods widens the interval instead of being averaged away.
        {calibrated && (
          <span className="ev__cal">
            Calibrated on 292 labelled photos (FloodDET), 5-fold cross-validation
            {analysis.calibration ? ` · fitted ${analysis.calibration}` : ""}.
          </span>
        )}
      </p>
    </div>
  );
}
