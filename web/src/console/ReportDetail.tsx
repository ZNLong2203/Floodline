import { useEffect, useRef, useState } from "react";
import { Icon, VehicleIcon } from "../components/Icon";
import { PriorityBadge, Probability, ReportStatusTag, StatusGlyph } from "../components/Status";
import { href } from "../lib/api";
import { vehicleName } from "../lib/catalog";
import {
  ageT,
  band,
  clock,
  dispatchDrafts,
  flagT,
  isClip,
  needT,
  reasonT,
  reportLang,
  STATUS,
  summaryOf,
  vulT,
  warnT,
} from "../lib/format";
import { type Key, useI18n } from "../lib/i18n";
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

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn--sm ${copied ? "btn--ok" : ""}`}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        }
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={15} />
      {copied ? t("common.copied") : t("common.copy")}
    </button>
  );
}

const flowKey = (f?: string) => `flow.${["still", "slow", "fast"].includes(f ?? "") ? f : "unclear"}` as Key;

export function ReportDetail({ report: r, vehicle, now, onClose, onStatus, onLocate }: Props) {
  const { t, lang } = useI18n();
  const [view, setView] = useState<"original" | "overlay">("original");
  const [busy, setBusy] = useState<ReportStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const a = r.analysis;
  const est = a?.estimate ?? null;
  const facts = r.triage?.facts ?? null;
  const p = r.triage?.priority ?? null;
  const clip = isClip(r);
  const rl = reportLang(r);
  const tag = (rl || "vi").toUpperCase();
  const flags = [
    ...new Set(a?.warnings ?? (a?.perception?.quality_flags ?? []).map((f) => `photo: ${f}`)),
  ];
  const usedCount = est?.used?.length ?? 0;
  const rejectedCount = est?.rejected?.length ?? 0;
  const measured = (a?.objects ?? []).filter((o) => o.readings.length).length;
  const tracked = (a?.objects ?? []).filter((o) => (o.frames_tracked ?? 0) > 0).length;
  const drafts = dispatchDrafts(r, lang);
  const words = [
    r.note ? { kind: "note" as const, text: r.note } : null,
    r.transcript ? { kind: "voice" as const, text: r.transcript } : null,
  ].filter((x): x is { kind: "note" | "voice"; text: string } => Boolean(x));
  const translation = facts?.message_en?.trim();
  const showTranslation = Boolean(translation) && rl !== "en" && words.length > 0;

  useEffect(() => {
    setView("original");
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
      setStatusError(t("status.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="detail" aria-label={t("detail.aria")}>
      <header className="detail__head">
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t("detail.back")} title={t("detail.back")}>
          <Icon name="back" />
        </button>
        <PriorityBadge priority={p} size="md" />
        <div className="detail__headtext">
          <div className="detail__title">
            {t(`band.${band(p)}` as Key)} · <span className="num">{clock(r.at)}</span>
          </div>
          <div className="detail__sub">
            {ageT(r.at, now, t)} · {t("detail.via", { source: r.source })} · <ReportStatusTag status={r.status} />
          </div>
        </div>
        <button type="button" className="iconbtn" onClick={onLocate} aria-label={t("detail.locate")} title={t("detail.locate")}>
          <Icon name="pin" />
        </button>
      </header>

      <div className="detail__scroll" ref={scroller}>
        {r.scenario && (
          <a className="scenario" href={href("/attribution")} target="_blank" rel="noreferrer">
            <Icon name="flag" size={14} />
            <span>{clip ? t("detail.scenarioVideo") : t("detail.scenarioPhoto")}</span>
            <Icon name="external" size={13} />
          </a>
        )}

        {clip ? (
          <ClipMedia report={r} />
        ) : (
          <figure className="photo">
            <div className="photo__frame" style={{ aspectRatio: a?.size ? `${a.size[0]} / ${a.size[1]}` : "4 / 3" }}>
              <img src={view === "original" ? r.image_url : r.overlay_url} alt={view === "original" ? t("photo.altOriginal") : t("photo.altOverlay")} />
              <div className="photo__toggle seg seg--dark" role="tablist" aria-label={t("photo.view")}>
                <button type="button" role="tab" aria-selected={view === "original"} className={view === "original" ? "is-on" : ""} onClick={() => setView("original")}>
                  {t("photo.original")}
                </button>
                <button type="button" role="tab" aria-selected={view === "overlay"} className={view === "overlay" ? "is-on" : ""} onClick={() => setView("overlay")}>
                  <Icon name="spark" size={14} /> {t("photo.models")}
                </button>
              </div>
              <a className="photo__open" href={view === "original" ? r.image_url : r.overlay_url} target="_blank" rel="noreferrer" aria-label={t("photo.open")}>
                <Icon name="external" size={15} />
              </a>
            </div>
            <figcaption className="photo__cap" lang={lang}>
              {summaryOf(r, lang)}
            </figcaption>
          </figure>
        )}

        <section className="dsec">
          <h3 className="dsec__title">{t("sec.words")}</h3>
          {words.length ? (
            <div className="words">
              {words.map((w) => (
                <blockquote key={w.kind} className={`quote ${w.kind === "voice" ? "quote--voice" : ""}`} lang={rl || undefined}>
                  <span className="quote__label">
                    {w.kind === "voice" && <Icon name="mic" size={13} />}
                    <span className="langtag">{t("words.original", { tag })}</span>
                    <span>{w.kind === "voice" ? t("words.voice") : t("words.note")}</span>
                  </span>
                  {w.text}
                </blockquote>
              ))}
              {showTranslation && (
                <blockquote className="quote quote--translation" lang="en">
                  <span className="quote__label">
                    <Icon name="spark" size={13} />
                    <span className="langtag langtag--en">{t("words.translated")}</span>
                  </span>
                  {translation}
                </blockquote>
              )}
            </div>
          ) : (
            <p className="muted">{t("words.none")}</p>
          )}
          {!!r.warnings?.length && (
            <ul className="flags flags--info">
              {r.warnings.map((w) => (
                <li key={w}>
                  <Icon name="info" size={15} />
                  {warnT(w, t)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dsec">
          <h3 className="dsec__title">{t("sec.depth")}</h3>
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
                  <Icon name="alert" /> {t("depth.none")}
                </div>
              )}
              <dl className="kv">
                <div>
                  <dt>{t("kv.readings")}</dt>
                  <dd>
                    {t("kv.used", { n: usedCount })}
                    {rejectedCount ? t("kv.rejected", { n: rejectedCount }) : ""}
                  </dd>
                </div>
                <div>
                  <dt>{t("kv.objects")}</dt>
                  <dd>{clip ? t("kv.tracked", { n: tracked }) : t("kv.measured", { n: measured })}</dd>
                </div>
                <div>
                  <dt>{t("kv.flow")}</dt>
                  <dd>{t(flowKey(a?.perception?.water_flow))}</dd>
                </div>
                {clip ? (
                  <div>
                    <dt>{t("kv.frames")}</dt>
                    <dd className="num">
                      {a?.frames ?? "–"}
                      {a?.fps ? ` @ ${a.fps} fps` : ""}
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt>{t("kv.water")}</dt>
                    <dd className="num">{a?.water_fraction != null ? `${Math.round(a.water_fraction * 100)}%` : "–"}</dd>
                  </div>
                )}
              </dl>
            </div>
            <DepthGauge estimate={est} verdicts={a?.verdicts ?? []} width={420} />
          </div>

          {!!a?.verdicts?.length && (
            <div className="verdicts" role="list" aria-label={t("verdicts.aria")}>
              {a.verdicts.map((v) => (
                <div role="listitem" key={v.vehicle} className={`verdict tone--${STATUS[v.status].tone} ${vehicle?.id === v.vehicle ? "is-current" : ""}`}>
                  <StatusGlyph status={v.status} size={18} />
                  <div className="verdict__name">
                    <span className="verdict__vi">
                      <VehicleIcon id={v.vehicle} size={15} /> {vehicleName(v, lang)}
                    </span>
                    <span className="verdict__en">{t("verdict.line", { status: t(`status.${v.status}` as Key), m: v.limit_m.toFixed(2) })}</span>
                  </div>
                  <Probability p={v.p_exceed} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="dsec">
          <h3 className="dsec__title">
            {t("sec.evidence")} <span className="dsec__hint">{t("sec.evidenceHint")}</span>
          </h3>
          {a ? <Evidence analysis={a} /> : null}
        </section>

        {flags.length > 0 && (
          <section className="dsec">
            <h3 className="dsec__title">{t("sec.quality")}</h3>
            <ul className="flags">
              {flags.map((f) => (
                <li key={f}>
                  <Icon name="alert" size={15} />
                  {flagT(f, t)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="dsec">
          <h3 className="dsec__title">
            {t("sec.triage")} <span className="dsec__hint">{t("sec.triageHint")}</span>
          </h3>
          {r.triage ? (
            <>
              <div className="reasons">
                {r.triage.reasons.length ? (
                  r.triage.reasons.map((x) => (
                    <span key={x} className="chip">
                      {reasonT(x, t)}
                    </span>
                  ))
                ) : (
                  <span className="muted">{t("triage.none")}</span>
                )}
              </div>
              {facts && (
                <dl className="facts">
                  <div>
                    <dt>{t("facts.people")}</dt>
                    <dd className="num">{facts.people_count || "–"}</dd>
                  </div>
                  <div>
                    <dt>{t("facts.vulnerable")}</dt>
                    <dd>{facts.vulnerable?.length ? facts.vulnerable.map((v) => vulT(v, t)).join(", ") : "–"}</dd>
                  </div>
                  <div>
                    <dt>{t("facts.injury")}</dt>
                    <dd className={facts.injury_or_medical ? "yes" : ""}>{facts.injury_or_medical ? t("common.yes") : t("common.no")}</dd>
                  </div>
                  <div>
                    <dt>{t("facts.trapped")}</dt>
                    <dd className={facts.trapped ? "yes" : ""}>{facts.trapped ? t("common.yes") : t("common.no")}</dd>
                  </div>
                  <div>
                    <dt>{t("facts.rising")}</dt>
                    <dd className={facts.water_rising === "yes" ? "yes" : ""}>
                      {facts.water_rising === "yes" ? t("common.yes") : facts.water_rising === "no" ? t("common.no") : t("common.unknown")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("facts.needs")}</dt>
                    <dd>{facts.needs?.length ? facts.needs.map((n) => needT(n, t)).join(", ") : "–"}</dd>
                  </div>
                  {facts.address_hint && (
                    <div className="facts__wide">
                      <dt>{t("facts.address")}</dt>
                      <dd lang={rl || undefined}>{facts.address_hint}</dd>
                    </div>
                  )}
                </dl>
              )}
            </>
          ) : (
            <div className="muted">{t("triage.not")}</div>
          )}
        </section>

        {drafts.length > 0 && (
          <section className="dsec">
            <h3 className="dsec__title">
              {t("sec.dispatch")} <span className="dsec__hint">{t("dispatch.hint")}</span>
            </h3>
            <div className="drafts">
              {drafts.map((d) => (
                <div key={d.lang} className="dispatch">
                  <span className={`langtag ${d.lang === "en" ? "langtag--en" : ""}`}>{d.lang.toUpperCase()}</span>
                  <p lang={d.lang}>{d.text}</p>
                  <CopyButton text={d.text} />
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="detail__meta">
          {t("detail.meta", { s: a?.seconds?.toFixed(1) ?? "–" })} · {r.lat.toFixed(5)}, {r.lon.toFixed(5)} · <span className="num">{r.id}</span>
        </div>
      </div>

      <footer className="detail__foot">
        {statusError && (
          <div className="detail__err" role="alert">
            {statusError}
          </div>
        )}
        <div className="statusbar" role="group" aria-label={t("status.aria")}>
          {(["acknowledged", "dispatched", "closed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`btn statusbtn statusbtn--${s} ${r.status === s ? "is-on" : ""}`}
              aria-pressed={r.status === s}
              disabled={busy !== null}
              onClick={() => setStatus(r.status === s ? "new" : s)}
              title={r.status === s ? t("status.undo") : undefined}
            >
              {busy === s ? <span className="spinner spinner--sm" /> : r.status === s ? <Icon name="check" size={15} /> : null}
              {s === "acknowledged" ? t("status.ack") : s === "dispatched" ? t("status.dispatched") : t("status.close")}
            </button>
          ))}
        </div>
        <div className="statusbar__now">{t("status.now", { s: t(`rstatus.${r.status}` as Key) })}</div>
      </footer>
    </aside>
  );
}
