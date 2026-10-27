import { useEffect, useRef, useState } from "react";
import { Icon, VehicleIcon } from "../components/Icon";
import { PriorityBadge, Probability, ReportStatusTag, StatusGlyph } from "../components/Status";
import { href } from "../lib/api";
import {
  age,
  band,
  BAND_LABEL,
  capitalise,
  clock,
  humanise,
  isClip,
  NEEDS_VI,
  REPORT_STATUS,
  STATUS,
  summaryOf,
  VULNERABLE_VI,
} from "../lib/format";
import type { Report, ReportStatus, Vehicle } from "../lib/types";
import { ClipMedia } from "./ClipMedia";
import { DepthGauge } from "./DepthGauge";
import { Evidence } from "./Evidence";

interface Props {
  report: Report;
  vehicle: Vehicle | undefined;
  now: number;
  onClose(): void;
  onStatus(id: string, status: ReportStatus): Promise<void>;
  onLocate(): void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function ReportDetail({ report: r, vehicle, now, onClose, onStatus, onLocate }: Props) {
  const [view, setView] = useState<"original" | "overlay">("original");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<ReportStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const a = r.analysis;
  const est = a?.estimate ?? null;
  const facts = r.triage?.facts ?? null;
  const p = r.triage?.priority ?? null;
  const clip = isClip(r);
  // Clip analyses carry Spark's quality flags in perception only.
  const flags = [
    ...new Set(a?.warnings ?? (a?.perception?.quality_flags ?? []).map((f) => `photo: ${f.replace(/_/g, " ")}`)),
  ];

  useEffect(() => {
    setView("original");
    setCopied(false);
    setStatusError(null);
    scroller.current?.scrollTo({ top: 0 });
  }, [r.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setStatus = async (s: ReportStatus) => {
    setBusy(s);
    setStatusError(null);
    try {
      await onStatus(r.id, s);
    } catch {
      setStatusError("Could not update the status. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const dispatch = facts?.dispatch_vi || "";
  const usedCount = est?.used?.length ?? 0;
  const rejectedCount = est?.rejected?.length ?? 0;
  const measured = (a?.objects ?? []).filter((o) => o.readings.length).length;

  return (
    <aside className="detail" aria-label="Report detail">
      <header className="detail__head">
        <button type="button" className="iconbtn" onClick={onClose} aria-label="Back to the queue">
          <Icon name="back" />
        </button>
        <PriorityBadge priority={p} size="md" />
        <div className="detail__headtext">
          <div className="detail__title">
            {BAND_LABEL[band(p)]} · <span className="num">{clock(r.at)}</span>
          </div>
          <div className="detail__sub">
            {age(r.at, now)} · via {r.source} · <ReportStatusTag status={r.status} />
          </div>
        </div>
        <button type="button" className="iconbtn" onClick={onLocate} aria-label="Show on map" title="Show on map">
          <Icon name="pin" />
        </button>
      </header>

      <div className="detail__scroll" ref={scroller}>
        {r.scenario && (
          <a className="scenario" href={href("/attribution")} target="_blank" rel="noreferrer">
            <Icon name="flag" size={14} />
            <span lang="vi">Kịch bản mô phỏng · {clip ? "video" : "ảnh"} thật từ Wikimedia Commons</span>
            <Icon name="external" size={13} />
          </a>
        )}

        {clip ? (
          <ClipMedia report={r} />
        ) : (
          <figure className="photo">
            <div className="photo__frame" style={{ aspectRatio: a?.size ? `${a.size[0]} / ${a.size[1]}` : "4 / 3" }}>
              <img
                src={view === "original" ? r.image_url : r.overlay_url}
                alt={view === "original" ? "Resident's photo" : "Water and object masks the models found"}
              />
              <div className="photo__toggle seg seg--dark" role="tablist" aria-label="Photo view">
                <button type="button" role="tab" aria-selected={view === "original"} className={view === "original" ? "is-on" : ""} onClick={() => setView("original")}>
                  Original
                </button>
                <button type="button" role="tab" aria-selected={view === "overlay"} className={view === "overlay" ? "is-on" : ""} onClick={() => setView("overlay")}>
                  <Icon name="spark" size={14} /> What the models saw
                </button>
              </div>
              <a className="photo__open" href={view === "original" ? r.image_url : r.overlay_url} target="_blank" rel="noreferrer" aria-label="Open the image full size">
                <Icon name="external" size={15} />
              </a>
            </div>
            <figcaption className="photo__cap" lang="vi">
              {summaryOf(r)}
            </figcaption>
          </figure>
        )}

        <section className="dsec">
          <h3 className="dsec__title">Depth</h3>
          <div className="depth">
            <div className="depth__head">
              {est ? (
                <div>
                  <div className="depth__big num">
                    {est.mean_m.toFixed(2)}
                    <span> m</span>
                  </div>
                  <div className="depth__range num">
                    {est.low_m.toFixed(2)}–{est.high_m.toFixed(2)} m <span className="muted">(±2σ)</span>
                  </div>
                </div>
              ) : (
                <div className="depth__none">
                  <Icon name="alert" /> No depth could be measured
                </div>
              )}
              <dl className="kv">
                <div>
                  <dt>Readings</dt>
                  <dd>
                    {usedCount} used{rejectedCount ? `, ${rejectedCount} rejected` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Objects</dt>
                  <dd>
                    {clip ? `${(a?.objects ?? []).filter((o) => (o.frames_tracked ?? 0) > 0).length} tracked` : `${measured} measured`}
                  </dd>
                </div>
                <div>
                  <dt>Water flow</dt>
                  <dd>{capitalise(a?.perception?.water_flow ?? "unclear")}</dd>
                </div>
                {clip ? (
                  <div>
                    <dt>Frames</dt>
                    <dd className="num">
                      {a?.frames ?? "–"}
                      {a?.fps ? ` @ ${a.fps} fps` : ""}
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt>Water in frame</dt>
                    <dd className="num">{a?.water_fraction != null ? `${Math.round(a.water_fraction * 100)}%` : "–"}</dd>
                  </div>
                )}
              </dl>
            </div>
            <DepthGauge estimate={est} verdicts={a?.verdicts ?? []} width={420} />
          </div>

          {!!a?.verdicts?.length && (
            <div className="verdicts" role="list" aria-label="Passability per vehicle">
              {a.verdicts.map((v) => (
                <div
                  role="listitem"
                  key={v.vehicle}
                  className={`verdict tone--${STATUS[v.status].tone} ${vehicle?.id === v.vehicle ? "is-current" : ""}`}
                >
                  <StatusGlyph status={v.status} size={18} />
                  <div className="verdict__name">
                    <span className="verdict__vi">
                      <VehicleIcon id={v.vehicle} size={15} /> {v.name_vi}
                    </span>
                    <span className="verdict__en">
                      {STATUS[v.status].en} · limit {v.limit_m.toFixed(2)} m
                    </span>
                  </div>
                  <Probability p={v.p_exceed} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="dsec">
          <h3 className="dsec__title">
            Evidence <span className="dsec__hint">how the depth was measured</span>
          </h3>
          {a ? <Evidence analysis={a} /> : null}
        </section>

        {flags.length > 0 && (
          <section className="dsec">
            <h3 className="dsec__title">Photo quality</h3>
            <ul className="flags">
              {flags.map((f) => (
                <li key={f}>
                  <Icon name="alert" size={15} />
                  {capitalise(humanise(f.replace(/^photo: /, "")))}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="dsec">
          <h3 className="dsec__title">
            Triage <span className="dsec__hint">published formula, not a model's opinion</span>
          </h3>
          {r.triage ? (
            <>
              <div className="reasons">
                {r.triage.reasons.length ? (
                  r.triage.reasons.map((x) => (
                    <span key={x} className="chip">
                      {x}
                    </span>
                  ))
                ) : (
                  <span className="muted">No risk factors reported.</span>
                )}
              </div>
              {facts && (
                <dl className="facts">
                  <div>
                    <dt>People</dt>
                    <dd className="num">{facts.people_count || "–"}</dd>
                  </div>
                  <div>
                    <dt>Vulnerable</dt>
                    <dd lang="vi">{facts.vulnerable.length ? facts.vulnerable.map((v) => VULNERABLE_VI[v] ?? v).join(", ") : "–"}</dd>
                  </div>
                  <div>
                    <dt>Injury / medical</dt>
                    <dd className={facts.injury_or_medical ? "yes" : ""}>{facts.injury_or_medical ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt>Trapped</dt>
                    <dd className={facts.trapped ? "yes" : ""}>{facts.trapped ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt>Water rising</dt>
                    <dd className={facts.water_rising === "yes" ? "yes" : ""}>{capitalise(facts.water_rising)}</dd>
                  </div>
                  <div>
                    <dt>Needs</dt>
                    <dd lang="vi">{facts.needs.length ? facts.needs.map((n) => NEEDS_VI[n] ?? n).join(", ") : "–"}</dd>
                  </div>
                  {facts.address_hint && (
                    <div className="facts__wide">
                      <dt>Address hint</dt>
                      <dd lang="vi">{facts.address_hint}</dd>
                    </div>
                  )}
                </dl>
              )}
            </>
          ) : (
            <div className="muted">Not triaged.</div>
          )}
          {r.note && (
            <blockquote className="quote" lang="vi">
              <span className="quote__label">Resident's note</span>
              {r.note}
            </blockquote>
          )}
          {r.transcript && (
            <blockquote className="quote quote--voice" lang="vi">
              <span className="quote__label">
                <Icon name="mic" size={13} /> Voice note, transcribed
              </span>
              {r.transcript}
            </blockquote>
          )}
        </section>

        {dispatch && (
          <section className="dsec">
            <h3 className="dsec__title">Dispatch message</h3>
            <div className="dispatch">
              <p lang="vi">{dispatch}</p>
              <button
                type="button"
                className={`btn btn--sm ${copied ? "btn--ok" : ""}`}
                onClick={async () => {
                  if (await copyText(dispatch)) {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1800);
                  }
                }}
              >
                <Icon name={copied ? "check" : "copy"} size={15} />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </section>
        )}

        <div className="detail__meta">
          Analysed in {a?.seconds?.toFixed(1) ?? "–"} s · {r.lat.toFixed(5)}, {r.lon.toFixed(5)} · <span className="num">{r.id}</span>
        </div>
      </div>

      <footer className="detail__foot">
        {statusError && (
          <div className="detail__err" role="alert">
            {statusError}
          </div>
        )}
        <div className="statusbar" role="group" aria-label="Set report status">
          {(["acknowledged", "dispatched", "closed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`btn statusbtn statusbtn--${s} ${r.status === s ? "is-on" : ""}`}
              aria-pressed={r.status === s}
              disabled={busy !== null}
              onClick={() => setStatus(r.status === s ? "new" : s)}
              title={r.status === s ? `Undo: mark as new` : undefined}
            >
              {busy === s ? <span className="spinner spinner--sm" /> : r.status === s ? <Icon name="check" size={15} /> : null}
              {s === "acknowledged" ? "Acknowledge" : s === "dispatched" ? "Dispatched" : "Close"}
            </button>
          ))}
        </div>
        <div className="statusbar__now">
          Status: <b>{REPORT_STATUS[r.status].en}</b>
        </div>
      </footer>
    </aside>
  );
}
