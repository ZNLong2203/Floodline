import { Icon } from "../components/Icon";
import { capitalise, OBJECT_VI, OVERLAY_PALETTE, summaryOf } from "../lib/format";
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
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Depth on ${n} frames, median ${med.toFixed(2)} metres`}>
      <polygon points={`0,${H} ${line} ${W},${H}`} className="spark__area" />
      <line x1="0" x2={W} y1={y(med)} y2={y(med)} className="spark__median" />
      <polyline points={line} fill="none" stroke={colour} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** For clip reports: the SAM 3.1 tracking video, per-object depth over time, and Spark's view. */
export function ClipMedia({ report: r }: { report: Report }) {
  const a = r.analysis;
  const objects = [...(a.objects ?? [])].sort((p, q) => p.index - q.index);
  const measured = objects.filter((o) => o.depth_by_frame?.length);
  const others = objects.filter((o) => !o.depth_by_frame?.length && (o.frames_tracked ?? 0) > 0);
  const top = Math.max(0.5, ...measured.flatMap((o) => o.depth_by_frame ?? [])) * 1.1;
  const sv = a.spark_video;
  const seconds = a.frames && a.fps ? Math.round(a.frames / a.fps) : null;
  const name = (o: ObjectFinding) => `${capitalise(o.label)}${OBJECT_VI[o.label] ? ` · ${OBJECT_VI[o.label]}` : ""}`;

  return (
    <>
      <figure className="photo">
        <div className="photo__frame clip__frame" style={{ aspectRatio: a.size ? `${a.size[0]} / ${a.size[1]}` : "16 / 9" }}>
          {r.video_url ? (
            <video
              key={r.video_url}
              src={r.video_url}
              poster={r.overlay_url}
              muted
              loop
              autoPlay
              playsInline
              controls
              preload="metadata"
              aria-label="SAM 3.1 tracking of the water and the reference objects, with waterlines and depth per frame"
            />
          ) : (
            <img src={r.overlay_url} alt="Key frame with the models' masks" />
          )}
          <span className="clip__badge">
            <Icon name="play" size={12} /> SAM 3.1 tracking · {a.frames ?? "?"} frames
            {seconds ? <span className="clip__badgesub"> · {seconds} s</span> : null}
          </span>
        </div>
        <figcaption className="photo__cap" lang="vi">
          {summaryOf(r)}
        </figcaption>
      </figure>

      {(measured.length > 0 || others.length > 0) && (
        <div className="clipobjs">
          <div className="clipobjs__head">
            <span>Depth on each frame</span>
            <span className="muted">raw, before calibration{a.fps ? ` · ${a.fps} fps` : ""}</span>
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
                  <b>{name(o)}</b>
                  <span className="muted">
                    {o.frames_measured ?? d.length} of {o.frames_tracked ?? "?"} frames
                  </span>
                </div>
                <Sparkline values={d} colour={colour} top={top} />
                <div className="clipobj__med num">
                  {median(d).toFixed(2)} m<span className="muted">median</span>
                </div>
              </div>
            );
          })}
          {others.length > 0 && (
            <div className="clipobjs__others">
              Also tracked, no waterline measured:{" "}
              {others.map((o, i) => (
                <span key={o.index}>
                  {i > 0 && ", "}
                  {o.label} #{o.index + 1} <span className="muted">({o.frames_tracked} frames)</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {sv?.what_happens_vi && (
        <blockquote className="quote quote--spark">
          <span className="quote__label">
            <Icon name="spark" size={13} /> Muse Spark watched the clip
          </span>
          <span lang="vi">{sv.what_happens_vi}</span>
          <span className="quote__meta">
            {sv.depth_m ? `Its own range ${sv.depth_m.low.toFixed(2)}–${sv.depth_m.high.toFixed(2)} m` : null}
            {sv.depth_m && sv.water_flow ? " · " : null}
            {sv.water_flow ? `water ${sv.water_flow}` : null}
          </span>
          {sv.speech_vi && (
            <span className="quote__speech" lang="vi">
              Lời nói trong clip: “{sv.speech_vi}”
            </span>
          )}
        </blockquote>
      )}
    </>
  );
}
