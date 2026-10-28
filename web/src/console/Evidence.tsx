import type { CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { humanise, OVERLAY_PALETTE, parseNote, parseSource, type ReadingKind } from "../lib/format";
import { type Key, useI18n, type Vars } from "../lib/i18n";
import type { Analysis, Reading } from "../lib/types";

type T = (k: Key, v?: Vars) => string;

/** Look up `${prefix}.${id}`, falling back to the raw id in words. */
function word(t: T, prefix: string, id: string): string {
  const k = `${prefix}.${id}` as Key;
  const s = t(k);
  return s === k ? humanise(id) : s;
}

type Fate = "used" | "rejected" | "none";

const same = (a: Reading, b: Reading) =>
  a.source === b.source && Math.abs(a.low_m - b.low_m) < 1e-6 && Math.abs(a.high_m - b.high_m) < 1e-6;

const centre = (r: Reading) => r.mean_m ?? (r.low_m + r.high_m) / 2;

function detail(r: Reading, t: T): string {
  const p = parseSource(r.source);
  const n = parseNote(r.note);
  const conf = n.confidence ? ` · ${t("ev.confidence", { c: word(t, "conf", n.confidence) })}` : "";
  switch (p.kind) {
    case "landmark":
      return t("ev.waterAt", { part: word(t, "lm", n.text) });
    case "closeup-landmark":
      return t("ev.waterAt", { part: word(t, "lm", n.text) }) + conf;
    case "fraction":
    case "closeup-fraction": {
      const f = Number(n.text);
      const what = Number.isFinite(f) ? t("ev.submerged", { p: Math.round(f * 100) }) : n.text;
      return p.kind === "fraction" ? what : `${what}${conf}`;
    }
    case "scale":
      return n.text || t("ev.visible");
    case "spark":
      return p.clip ? t("ev.wholeClip") : t("ev.wholePhoto");
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
  const { t } = useI18n();
  const est = analysis.estimate;
  const fate = (r: Reading): Fate =>
    est?.rejected?.some((x) => same(x, r)) ? "rejected" : est?.used?.some((x) => same(x, r)) ? "used" : "none";

  const groups: Group[] = [];
  const claimed: Reading[] = [];
  for (const o of [...(analysis.objects ?? [])].sort((a, b) => a.index - b.index)) {
    claimed.push(...o.readings);
    const meta = [
      o.orientation && o.orientation !== "unclear" ? word(t, "orient", o.orientation) : null,
      o.landmark && o.landmark !== "unclear" ? t("ev.waterAtMeta", { part: word(t, "lm", o.landmark) }) : null,
      o.sam_confidence != null ? `SAM ${o.sam_confidence.toFixed(2)}` : null,
      o.frames_tracked != null ? t("ev.tracked", { n: o.frames_tracked }) : null,
      o.frames_measured ? t("ev.waterline", { n: o.frames_measured }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    groups.push({
      key: `o${o.index}`,
      index: o.index,
      title: word(t, "obj", o.label),
      meta,
      colour: OVERLAY_PALETTE[o.index % OVERLAY_PALETTE.length],
      readings: o.readings,
      muted:
        o.standing_in_water === false ? t("ev.notStanding") : !o.readings.length ? t("ev.noReading") : undefined,
    });
  }
  const loose = [...(est?.used ?? []), ...(est?.rejected ?? [])].filter((r) => !claimed.some((c) => same(c, r)));
  if (loose.length)
    groups.push({
      key: "photo",
      index: null,
      title: analysis.kind === "clip" ? t("ev.groupClip") : t("ev.groupPhoto"),
      meta: analysis.kind === "clip" ? t("ev.groupClipMeta") : t("ev.groupPhotoMeta"),
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
      <div className="ev ev--empty">{t("ev.empty")}</div>
    );
  }

  return (
    <div className="ev" style={{ "--max": max } as CSSProperties}>
      <div className="ev__legend">
        {LEGEND_ORDER.filter((k) => kindsPresent.has(k)).map((k) => (
          <span key={k} className={`ev__key kind--${k}`} title={t(`hint.${k}` as Key)}>
            <i />
            {t(`kind.${k}` as Key)}
          </span>
        ))}
        {raws.length > 0 && (
          <span className="ev__key ev__key--raw" title={t("ev.rawTitle")}>
            <i />
            {t("ev.raw")}
          </span>
        )}
        {rejectedCount > 0 && (
          <span className="ev__key ev__key--rej">
            <i />
            {t("ev.rejected")}
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
                    <span className="ev__swatch ev__swatch--spark" aria-hidden="true">
                      <Icon name="image" size={11} strokeWidth={2.4} />
                    </span>
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
                  `${t(`kind.${p.kind}` as Key)}: ${r.low_m.toFixed(2)}–${r.high_m.toFixed(2)} m`,
                  n.raw ? t("ev.beforeCal", { a: n.raw[0].toFixed(2), b: n.raw[1].toFixed(2) }) : null,
                  f === "rejected" ? t("ev.rejectedTag") : null,
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
                      <span className="ev__kind" title={t(`hint.${p.kind}` as Key)}>
                        {closeup && <span aria-hidden="true">⌕ </span>}
                        {closeup ? t("kind.closeup") : t(`kind.${p.kind}` as Key)}
                        {p.clip && p.kind !== "spark" && <span className="ev__cliptag">{t("ev.clip")}</span>}
                      </span>
                      <span className="ev__nums num">
                        {r.low_m.toFixed(2)}–{r.high_m.toFixed(2)}
                      </span>
                      <span className="ev__detail">{detail(r, t)}</span>
                      {f === "rejected" && <span className="ev__rejtag">{t("ev.rejectedTag")}</span>}
                    </div>
                    <div className="ev__track">
                      {n.raw && (
                        <span
                          className="ev__raw"
                          style={{ left: pos(n.raw[0]), width: span(n.raw[0], n.raw[1]) }}
                          title={t("ev.beforeCal", { a: n.raw[0].toFixed(2), b: n.raw[1].toFixed(2) })}
                        />
                      )}
                      <span
                        className={`ev__bar ${r.high_m > max ? "is-clipped" : ""}`}
                        style={{ left: pos(r.low_m), width: span(r.low_m, r.high_m) }}
                      />
                      {r.high_m > max && <span className="ev__more" aria-hidden="true" title={t("ev.continues", { m: r.high_m.toFixed(2) })} />}
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
                <span className="ev__kind">{t("ev.consensus")}</span>
                <span className="ev__nums num">
                  {est.low_m.toFixed(2)}–{est.high_m.toFixed(2)}
                </span>
                <span className="ev__detail">
                  {t("kv.used", { n: est.used.length })}
                  {rejectedCount ? t("kv.rejected", { n: rejectedCount }) : ""}
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
        {t("ev.foot")}
        {calibrated && (
          <span className="ev__cal">
            {t("ev.cal")}
            {analysis.calibration ? t("ev.fitted", { date: analysis.calibration }) : ""}.
          </span>
        )}
      </p>
    </div>
  );
}
