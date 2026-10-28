import { Icon } from "../components/Icon";
import { OVERLAY_PALETTE, reportLang, summaryOf } from "../lib/format";
import { type Key, useI18n } from "../lib/i18n";
import type { ObjectFinding, Report } from "../lib/types";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const W = 190;
const H = 34;

function Sparkline({ values, colour, top }: { values: number[]; colour: string; top: number }) {
  const n = values.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - 2 - (Math.max(0, v) / top) * (H - 4);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const med = median(values);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${n} × depth, median ${med.toFixed(2)} m`}>
      <polygon points={`0,${H} ${line} ${W},${H}`} className="spark__area" />
      <line x1="0" x2={W} y1={y(med)} y2={y(med)} className="spark__median" />
      <polyline points={line} fill="none" stroke={colour} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** For clip reports: the SAM 3.1 tracking video, per-object depth over time, and Spark's view. */
export function ClipMedia({ report: r }: { report: Report }) {
  const { t, lang } = useI18n();
  const a = r.analysis;
  const objects = [...(a.objects ?? [])].sort((p, q) => p.index - q.index);
  const measured = objects.filter((o) => o.depth_by_frame?.length);
  const others = objects.filter((o) => !o.depth_by_frame?.length && (o.frames_tracked ?? 0) > 0);
  const top = Math.max(0.5, ...measured.flatMap((o) => o.depth_by_frame ?? [])) * 1.1;
  const sv = a.spark_video;
  const seconds = a.frames && a.fps ? Math.round(a.frames / a.fps) : null;
  const objName = (o: ObjectFinding) => {
    const k = `obj.${o.label}` as Key;
    const s = t(k);
    return s === k ? o.label : s;
  };
  // Spark's description in the reader's language, with the other language beneath.
  const rl = reportLang(r) || "vi";
  const local = sv?.what_happens_local || sv?.what_happens_vi;
  const english = sv?.what_happens_en;
  const primary = lang === rl ? local || english : english || local;
  const secondary = primary === english ? local : english;
  const speech = sv?.speech || sv?.speech_vi;

  return (
    <>
      <figure className="photo">
        <div className="photo__frame clip__frame" style={{ aspectRatio: a.size ? `${a.size[0]} / ${a.size[1]}` : "16 / 9" }}>
          {r.video_url ? (
            <video key={r.video_url} src={r.video_url} poster={r.overlay_url} muted loop autoPlay playsInline controls preload="metadata" aria-label={t("clip.aria")} />
          ) : (
            <img src={r.overlay_url} alt={t("photo.altOverlay")} />
          )}
          <span className="clip__badge">
            <Icon name="play" size={12} /> {t("clip.badge", { n: a.frames ?? "?" })}
            {seconds ? <span className="clip__badgesub"> · {seconds} s</span> : null}
          </span>
        </div>
        <figcaption className="photo__cap" lang={lang}>
          {summaryOf(r, lang)}
        </figcaption>
      </figure>

      {(measured.length > 0 || others.length > 0) && (
        <div className="clipobjs">
          <div className="clipobjs__head">
            <span>{t("clip.depthTitle")}</span>
            <span className="muted">
              {t("clip.raw")}
              {a.fps ? ` · ${a.fps} fps` : ""}
            </span>
          </div>
          {measured.map((o) => {
            const d = o.depth_by_frame!;
            const colour = OVERLAY_PALETTE[o.index % OVERLAY_PALETTE.length];
            return (
              <div key={o.index} className="clipobj">
                <span className="ev__swatch" style={{ background: colour }}>
                  {o.index + 1}
                </span>
                <div className="clipobj__name">
                  <b>{objName(o)}</b>
                  <span className="muted">{t("clip.framesOf", { m: o.frames_measured ?? d.length, n: o.frames_tracked ?? "?" })}</span>
                </div>
                <Sparkline values={d} colour={colour} top={top} />
                <div className="clipobj__med num">
                  {median(d).toFixed(2)} m<span className="muted">{t("clip.median")}</span>
                </div>
              </div>
            );
          })}
          {others.length > 0 && (
            <div className="clipobjs__others">
              {t("clip.others")}{" "}
              {others.map((o, i) => (
                <span key={o.index}>
                  {i > 0 && ", "}
                  {objName(o).toLowerCase()} #{o.index + 1} <span className="muted">({t("clip.frames", { n: o.frames_tracked ?? 0 })})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {primary && (
        <blockquote className="quote quote--spark">
          <span className="quote__label">
            <Icon name="video" size={13} /> {t("clip.spark")}
          </span>
          <span lang={primary === english ? "en" : rl}>{primary}</span>
          {secondary && secondary !== primary && (
            <span className="quote__second" lang={secondary === english ? "en" : rl}>
              <span className="langtag">{(secondary === english ? "en" : rl).toUpperCase()}</span> {secondary}
            </span>
          )}
          <span className="quote__meta">
            {sv?.depth_m ? t("clip.ownRange", { a: sv.depth_m.low.toFixed(2), b: sv.depth_m.high.toFixed(2) }) : null}
            {sv?.depth_m && sv?.water_flow ? " · " : null}
            {sv?.water_flow ? t("clip.flow", { f: t(`flow.${sv.water_flow}` as Key).toLowerCase() }) : null}
          </span>
          {speech && (
            <span className="quote__speech">
              <span className="quote__label">{t("clip.speech")}</span>
              <span lang={rl}>
                <span className="langtag">{rl.toUpperCase()}</span> “{speech}”
              </span>
              {sv?.speech_en && sv.speech_en !== speech && (
                <span lang="en">
                  <span className="langtag langtag--en">EN</span> “{sv.speech_en}”
                </span>
              )}
            </span>
          )}
        </blockquote>
      )}
    </>
  );
}
