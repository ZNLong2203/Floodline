import { useEffect, useRef, useState } from "react";
import { Icon, Logo, VehicleIcon } from "../components/Icon";
import { MapLegend } from "../components/MapLegend";
import { StatusGlyph } from "../components/Status";
import { api, ApiError, href, isMock } from "../lib/api";
import { vehicleKind, vehicleName } from "../lib/catalog";
import { emergencyNumber, FALLBACK_CITIES, saveCity, savedCity } from "../lib/cities";
import { pct, reportLang, STATUS, summaryOf, warnT } from "../lib/format";
import { type Key, type Lang, LANG_NAME, LANGS, useI18n } from "../lib/i18n";
import type { City, Report, Sample, Vehicle, Verdict } from "../lib/types";
import { type LatLon, LocationPicker } from "./LocationPicker";
import { ReportMap } from "./ReportMap";
import { VoiceRecorder } from "./VoiceRecorder";

// When each progress step starts, in seconds: photos take 10–20 s, clips 60–150 s.
const PHOTO_AT = [0, 3, 7, 12];
const VIDEO_AT = [0, 15, 60, 110];

type Phase = "form" | "sending" | "done" | "error";
type Failure = { title: Key; body: Key; vars?: Record<string, string>; network?: boolean; detail?: string };

/** "live": map behind a docked form (≥1024 px). "still": dimmed map behind the column (768–1023). */
function useLayout(): { mode: "live" | "still" | "none"; panel: number; wide: boolean } {
  const get = () => {
    const w = window.innerWidth;
    return {
      mode: w >= 1024 ? ("live" as const) : w >= 768 ? ("still" as const) : ("none" as const),
      panel: Math.round(Math.min(480, Math.max(440, w * 0.34))),
      // From 1280 px the "What happens next" card fits beside the map; below, it folds to one line.
      wide: w >= 1280,
    };
  };
  const [v, setV] = useState(get);
  useEffect(() => {
    const on = () => setV(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export default function ReportPage() {
  const { t, lang, setLang } = useI18n();
  const [cities, setCities] = useState<City[]>(FALLBACK_CITIES);
  const [cityId, setCityId] = useState<string>(() => savedCity() ?? FALLBACK_CITIES[0].id);
  const city = cities.find((c) => c.id === cityId) ?? cities[0];
  // The photo or the video, whichever the resident chose.
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [clipSeconds, setClipSeconds] = useState<number | null>(null);
  const isVideo = Boolean(photo?.type.startsWith("video/"));
  const [where, setWhere] = useState<LatLon | null>(() => city.center);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<Failure | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const recorder = useRef<HTMLInputElement>(null);
  const online = useOnline();
  // The public demo replays recorded answers: only sample photos, sent without words, analyse.
  const [replayOnly, setReplayOnly] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sample, setSample] = useState<string | null>(null);
  const [sampleLoading, setSampleLoading] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState(false);
  const wordsOff = replayOnly && Boolean(sample);
  const layout = useLayout();
  const [focusKey, setFocusKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mapVehicle, setMapVehicle] = useState<Vehicle | undefined>(undefined);
  // The pin follows the city (also once the city list loads) until the resident moves it.
  const pinTouched = useRef(false);
  const movePin = (p: LatLon) => {
    pinTouched.current = true;
    setWhere(p);
  };
  useEffect(() => {
    if (!pinTouched.current) setWhere(city.center);
  }, [city.id, city.center]);

  useEffect(() => {
    document.title = t("rp.docTitle");
  }, [t]);

  useEffect(() => {
    api
      .cities()
      .then((cs) => Array.isArray(cs) && cs.length && setCities(cs))
      .catch(() => undefined);
    api
      .health()
      .then((h) => setReplayOnly(!h.has_key || h.mode === "replay"))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    setSamples([]);
    api
      .samples(city.id)
      .then((list) => live && setSamples(Array.isArray(list) ? list : []))
      .catch(() => live && setSamples([]));
    return () => {
      live = false;
    };
  }, [city.id]);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(photo);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);

  useEffect(() => {
    if (phase !== "sending") return;
    const t0 = performance.now();
    const id = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 200);
    return () => window.clearInterval(id);
  }, [phase]);

  const chooseCity = (id: string, movePin = true) => {
    if (id === cityId) return;
    setCityId(id);
    saveCity(id);
    const c = cities.find((x) => x.id === id);
    if (movePin && c) {
      pinTouched.current = false;
      setWhere(c.center);
    }
    // Samples belong to a city: a sample from another city would not replay.
    if (sample) {
      setPhoto(null);
      setSample(null);
    }
  };

  const pickSample = async (s: Sample, i: number) => {
    setSampleLoading(s.path);
    setSampleError(false);
    try {
      const res = await fetch(s.url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const name = s.path.split("/").pop() || "sample.jpg";
      setPhoto(new File([blob], name, { type: blob.type || "image/jpeg" }));
      setClipSeconds(null);
      setSample(s.path);
      // Somewhere in this city, a little apart for each sample so markers do not stack.
      const [lat, lon] = city.center;
      movePin([lat + ((i % 2) - 0.5) * 0.004, lon + (Math.floor(i / 2) - 0.5) * 0.004]);
      if (replayOnly) {
        setNote("");
        setAudio(null);
      }
    } catch {
      setSampleError(true);
    } finally {
      setSampleLoading(null);
    }
  };

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setPhoto(f);
      setClipSeconds(null);
      setSample(null);
    }
    e.target.value = "";
  };

  const clearMedia = () => {
    setPhoto(null);
    setSample(null);
    setClipSeconds(null);
  };

  const submit = async () => {
    if (!photo || !where) return;
    setPhase("sending");
    setElapsed(0);
    setError(null);
    window.scrollTo({ top: 0 });
    const ctrl = new AbortController();
    abort.current = ctrl;
    const timeout = window.setTimeout(() => ctrl.abort(), isVideo ? 330_000 : 120_000);
    try {
      const r = await api.createReport(
        {
          photo: isVideo ? null : photo,
          video: isVideo ? photo : null,
          lat: where[0],
          lon: where[1],
          note: wordsOff ? "" : note.trim(),
          audio: wordsOff ? null : audio,
          source: "web",
          city: city.id,
        },
        ctrl.signal,
      );
      setResult(r);
      setPhase("done");
      setRefreshKey((k) => k + 1);
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        if (abort.current === null) {
          setPhase("form");
          return;
        }
        setError({ title: "rp.err.timeout", body: "rp.err.timeoutBody" });
      } else if ((e instanceof ApiError && e.network) || e instanceof TypeError || !navigator.onLine) {
        setError({ title: "rp.err.network", body: "rp.err.networkBody", network: true });
      } else if (e instanceof ApiError && e.status === 503) {
        setError({ title: isVideo ? "rp.err.recordedVideo" : "rp.err.recordedPhoto", body: "rp.err.recordedBody", detail: err.message });
      } else if (e instanceof ApiError && e.status && e.status < 500) {
        setError({ title: "rp.err.invalid", body: "rp.err.invalidBody", vars: { msg: err.message } });
      } else {
        setError({ title: "rp.err.busy", body: "rp.err.busyBody" });
      }
      setPhase("error");
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const cancel = () => {
    const c = abort.current;
    abort.current = null;
    c?.abort();
  };

  const reset = () => {
    clearMedia();
    setAudio(null);
    setNote("");
    setResult(null);
    setError(null);
    setPhase("form");
    window.scrollTo({ top: 0 });
  };

  const emergency = emergencyNumber(city);
  const reason = !photo ? t("res.needMedia") : !where ? t("res.needPlace") : null;

  return (
    <div className={`rpshell rpshell--${layout.mode}`}>
      {layout.mode !== "none" && (
        <ReportMap
          key={layout.mode}
          mode={layout.mode}
          city={city}
          where={where}
          onPick={layout.mode === "live" && phase === "form" ? movePin : undefined}
          padLeft={layout.mode === "live" ? layout.panel + 48 : 0}
          padRight={layout.mode === "live" ? (layout.wide ? 340 : 0) : 0}
          fresh={phase === "done" ? result : null}
          focusKey={focusKey}
          refreshKey={refreshKey}
          onVehicle={setMapVehicle}
        />
      )}
      {layout.mode === "live" && (
        <aside className={`rp__aside ${layout.wide ? "" : "rp__aside--compact"}`}>
          {mapVehicle && <MapLegend vehicleName={vehicleName(mapVehicle, lang)} limit={mapVehicle.max_depth_m} compact />}
          <details className="rp__next" open={layout.wide} aria-labelledby="next-title">
            <summary>
              <h2 id="next-title">{t("res.next")}</h2>
              <Icon name="down" size={15} />
            </summary>
            <ol>
              <li>{t("res.next1")}</li>
              <li>{t("res.next2")}</li>
              <li>{t("res.next3")}</li>
            </ol>
            <p className="rp__nextsafety">
              <Icon name="alert" size={15} />
              <span>
                {t("res.safety")} {t("res.emergency", { n: emergencyNumber(city) })}
              </span>
            </p>
          </details>
        </aside>
      )}
    <div className="rp" style={layout.mode === "live" ? ({ "--panel-w": `${layout.panel}px` } as React.CSSProperties) : undefined}>
      <header className="rp__bar">
        <a href={href("/report")} className="rp__brand" aria-label="Floodline">
          <Logo size={26} />
          <span className="wordmark">Floodline</span>
          {isMock && <span className="mocktag">MOCK</span>}
        </a>
        <label className="rp__select rp__select--lang">
          <span className="sr-only">{t("res.language")}</span>
          <Icon name="globe" size={15} />
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()} · {LANG_NAME[l]}
              </option>
            ))}
          </select>
          <span className="rp__selval" aria-hidden="true">
            {lang.toUpperCase()}
          </span>
          <Icon name="down" size={14} />
        </label>
      </header>

      <main className="rp__main">
        {phase === "form" && (
          <>
            <h1 className="rp__h1">
              {t("res.heading")}{" "}
              <label className="rp__citysel">
                <span className="sr-only">{t("res.city")}</span>
                <select value={city.id} onChange={(e) => chooseCity(e.target.value)}>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="rp__citysel-val" aria-hidden="true">
                  {city.name}
                </span>
                <Icon name="down" size={18} />
              </label>
            </h1>

            {replayOnly && (
              <p className="rp__info">
                <Icon name="info" size={16} />
                <span>{t("res.demo")}</span>
              </p>
            )}
            {!online && (
              <p className="rp__info rp__info--warn" role="status">
                <Icon name="wifiOff" size={16} />
                <span>{t("rp.offline")}</span>
              </p>
            )}

            <section className="rp__sec" aria-labelledby="s1">
              <h2 id="s1" className="rp__h2">
                <span className="rp__n">1</span> {t("res.step1")}
              </h2>
              <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
              <input ref={recorder} type="file" accept="video/*" capture="environment" hidden onChange={pick} />
              <input ref={gallery} type="file" accept="image/*,video/*" hidden onChange={pick} />

              {preview ? (
                <div className="rp__preview">
                  <div className="rp__previewmedia">
                    {isVideo ? (
                      <video
                        src={preview}
                        controls
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(e) => {
                          const d = e.currentTarget.duration;
                          setClipSeconds(Number.isFinite(d) ? d : null);
                        }}
                        aria-label={t("res.yourVideo")}
                      />
                    ) : (
                      <img src={preview} alt={sample ? t("res.samplePhoto") : t("res.yourPhoto")} />
                    )}
                  </div>
                  <div className="rp__previewbar">
                    <span>
                      <b>{sample ? t("res.samplePhoto") : isVideo ? t("res.yourVideo") : t("res.yourPhoto")}</b>
                      {isVideo && clipSeconds != null && <small className="num">{t("res.clipLength", { s: Math.round(clipSeconds) })}</small>}
                    </span>
                    <button type="button" className="btn btn--sm" onClick={clearMedia}>
                      {t("res.change")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rp__pick">
                    <button type="button" className="btn rp__pickbtn" onClick={() => camera.current?.click()}>
                      <Icon name="camera" size={20} />
                      {t("res.takePhoto")}
                    </button>
                    <button type="button" className="btn rp__pickbtn" onClick={() => recorder.current?.click()}>
                      <Icon name="video" size={20} />
                      {t("res.recordVideo")}
                    </button>
                  </div>
                  <div className="rp__pickfoot">
                    <button type="button" className="linkbtn" onClick={() => gallery.current?.click()}>
                      {t("res.gallery")}
                    </button>
                    <span className="muted">{t("res.videoHint")}</span>
                  </div>
                </>
              )}

              {samples.length > 0 && (
                <div className="samples">
                  <p className="samples__title">{t("res.samples")}</p>
                  <div className="samples__grid">
                    {samples.map((s, i) => (
                      <button
                        key={s.path}
                        type="button"
                        className={`samples__item ${sample === s.path ? "is-on" : ""}`}
                        aria-pressed={sample === s.path}
                        aria-label={t("res.sampleN", { n: i + 1 })}
                        disabled={Boolean(sampleLoading)}
                        onClick={() => pickSample(s, i)}
                      >
                        <img src={s.url} alt="" loading="lazy" />
                        {sampleLoading === s.path && (
                          <span className="samples__busy">
                            <span className="spinner spinner--sm" />
                          </span>
                        )}
                        {sample === s.path && (
                          <span className="samples__check" aria-hidden="true">
                            <Icon name="check" size={13} strokeWidth={2.8} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {sampleError && (
                    <p className="samples__err" role="alert">
                      {t("rp.sampleError")}
                    </p>
                  )}
                </div>
              )}
            </section>

            <section className="rp__sec" aria-labelledby="s2">
              <h2 id="s2" className="rp__h2">
                <span className="rp__n">2</span> {t("res.step2")}
              </h2>
              <LocationPicker
                cities={cities}
                city={city}
                onCity={(id) => chooseCity(id, false)}
                value={where}
                onChange={movePin}
                onShowBigMap={layout.mode === "live" ? () => setFocusKey((k) => k + 1) : undefined}
              />
            </section>

            <section className="rp__sec" aria-labelledby="s3">
              <h2 id="s3" className="rp__h2">
                <span className="rp__n">3</span> {t("res.step3")} <span className="rp__opt">{t("res.optional")}</span>
              </h2>
              {wordsOff ? (
                <p className="rp__hint">
                  <Icon name="info" size={15} />
                  <span>{t("res.wordsOff")}</span>
                </p>
              ) : (
                <div className="rp__msg">
                  <label htmlFor="note" className="sr-only">
                    {t("res.step3")}
                  </label>
                  <textarea
                    id="note"
                    rows={3}
                    maxLength={600}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("res.notePh")}
                  />
                  <div className="rp__msgbar">
                    <VoiceRecorder value={audio} onChange={setAudio} compact />
                  </div>
                </div>
              )}
            </section>

            <div className="rp__sticky">
              <button type="button" className="btn btn--primary btn--block rp__send" disabled={Boolean(reason)} onClick={submit}>
                <Icon name="send" size={17} /> {t("res.send")}
              </button>
              {reason && <p className="rp__reason">{reason}</p>}
            </div>
          </>
        )}

        {phase === "sending" && <Sending elapsed={elapsed} preview={preview} video={isVideo} onCancel={cancel} />}

        {phase === "error" && error && (
          <div className="rp__error" role="alert">
            <Icon name={error.network ? "wifiOff" : "alert"} size={26} />
            <h1>{t(error.title)}</h1>
            <p>{t(error.body, error.vars)}</p>
            {error.detail && <p className="rp__errdetail">{error.detail}</p>}
            <button type="button" className="btn btn--primary btn--block" onClick={submit}>
              <Icon name="refresh" size={16} /> {t("rp.retry")}
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={() => setPhase("form")}>
              {t("rp.edit")}
            </button>
            <p className="rp__safety">{t("res.emergency", { n: emergency })}</p>
          </div>
        )}

        {phase === "done" && result && <Result report={result} emergency={emergency} onAgain={reset} />}
      </main>
    </div>
    </div>
  );
}

function Sending({ elapsed, preview, video, onCancel }: { elapsed: number; preview: string | null; video: boolean; onCancel(): void }) {
  const { t } = useI18n();
  const at = video ? VIDEO_AT : PHOTO_AT;
  const labels = [
    video ? t("res.p.video.0") : t("res.p.photo.0"),
    video ? t("res.p.video.1") : t("res.p.photo.1"),
    t("res.p.2"),
    t("res.p.3"),
  ];
  const idx = at.reduce((acc, s, i) => (elapsed >= s ? i : acc), 0);
  const progress = Math.min(0.95, 1 - Math.exp(-elapsed / (video ? 50 : 8)));
  return (
    <div className="rp__progress" aria-live="polite">
      <h1 className="rp__h1">{t("res.sending")}</h1>
      {preview && (
        <div className="rp__progthumb">
          {video ? <video src={preview} muted autoPlay loop playsInline /> : <img src={preview} alt="" />}
        </div>
      )}
      <ol className="rp__steps">
        {labels.map((label, i) => (
          <li key={label} className={i < idx ? "is-done" : i === idx ? "is-now" : ""}>
            <span className="rp__stepmark" aria-hidden="true">
              {i < idx ? <Icon name="check" size={13} strokeWidth={2.8} /> : i === idx ? <span className="spinner spinner--sm" /> : null}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <p className="muted rp__wait">{video ? t("res.waitVideo") : t("res.waitPhoto")}</p>
      <button type="button" className="btn btn--ghost" onClick={onCancel}>
        {t("rp.cancel")}
      </button>
    </div>
  );
}

/** Scooter, car, truck and on foot, in that order: what residents ask about. */
function residentVerdicts(verdicts: Verdict[]): Verdict[] {
  const order = ["scooter", "car", "truck", "walk"] as const;
  return order
    .map((k) => verdicts.find((v) => vehicleKind(v.vehicle) === k))
    .filter((v): v is Verdict => Boolean(v));
}

function Result({ report, emergency, onAgain }: { report: Report; emergency: string; onAgain(): void }) {
  const { t, lang } = useI18n();
  const a = report.analysis;
  const est = a.estimate;
  const verdicts = residentVerdicts(a.verdicts ?? []);
  const [view, setView] = useState<"overlay" | "original">("overlay");
  const summary = summaryOf(report, lang);
  const sv = a.spark_video;
  const rl = reportLang(report);
  const watched =
    lang === rl ? sv?.what_happens_local || sv?.what_happens_en : sv?.what_happens_en || sv?.what_happens_local || sv?.what_happens_vi;
  const bar = (m: number) => `${(Math.min(Math.max(m, 0), 2) / 2) * 100}%`;

  return (
    <div className="rp__result">
      <h1 className="rp__h1">{t("res.title")}</h1>

      {est ? (
        <>
          <ul className="rv">
            {verdicts.map((v) => (
              <li
                key={v.vehicle}
                className={`rv__item tone--${STATUS[v.status].tone}`}
                title={t("res.vTitle", { m: v.limit_m.toFixed(2), p: pct(v.p_exceed) })}
              >
                <StatusGlyph status={v.status} size={22} />
                <VehicleIcon id={v.vehicle} size={20} />
                <span className="rv__name">{vehicleName(v, lang)}</span>
                <b className="rv__status">{t(`res.v.${v.status}` as Key)}</b>
              </li>
            ))}
          </ul>

          <div className="rp__depth">
            <div className="rp__depthrow">
              <span>{t("res.depth")}</span>
              <b className="num">
                {est.low_m.toFixed(2)}–{est.high_m.toFixed(2)} m
              </b>
            </div>
            <div className="minibar" aria-hidden="true">
              <span className="minibar__band" style={{ left: bar(est.low_m), width: `calc(${bar(est.high_m)} - ${bar(est.low_m)})` }} />
              <span className="minibar__mean" style={{ left: bar(est.mean_m) }} />
              <span className="minibar__t minibar__t--start" style={{ left: "0%" }}>
                0
              </span>
              <span className="minibar__t" style={{ left: "50%" }}>
                1 m
              </span>
              <span className="minibar__t minibar__t--end" style={{ left: "100%" }}>
                2 m
              </span>
            </div>
          </div>
        </>
      ) : (
        <p className="rp__info">
          <Icon name="alert" size={16} />
          <span>{t("res.noDepth")}</span>
        </p>
      )}

      <details className="rp__measured" open>
        <summary>
          <span>{t("res.measured")}</span>
          <Icon name="down" size={16} />
        </summary>
        <div className="rp__measuredbody">
          {report.video_url ? (
            <div className="rp__media">
              <video src={report.video_url} poster={report.overlay_url} muted loop autoPlay playsInline controls aria-label={t("clip.aria")} />
            </div>
          ) : (
            <div className="rp__media">
              <img src={view === "overlay" ? report.overlay_url : report.image_url} alt={view === "overlay" ? t("photo.altOverlay") : t("photo.altOriginal")} />
              <div className="seg seg--dark rp__mediatoggle" role="tablist">
                <button type="button" role="tab" aria-selected={view === "overlay"} className={view === "overlay" ? "is-on" : ""} onClick={() => setView("overlay")}>
                  {t("rp.aiSaw")}
                </button>
                <button type="button" role="tab" aria-selected={view === "original"} className={view === "original" ? "is-on" : ""} onClick={() => setView("original")}>
                  {t("rp.original")}
                </button>
              </div>
            </div>
          )}
          {summary && summary !== "–" && <p className="rp__summary">{summary}</p>}
          {watched && (
            <p className="rp__summary muted">
              {t("rp.sparkWatched")} {watched}
            </p>
          )}
        </div>
      </details>

      <p className="rp__safety">
        <Icon name="alert" size={16} />
        <span>
          <b>{t("res.safety")}</b> {t("res.emergency", { n: emergency })}
        </span>
      </p>

      {!!report.warnings?.length && (
        <ul className="rp__notes" role="status">
          {report.warnings.map((w) => (
            <li key={w}>
              <Icon name="info" size={14} /> {warnT(w, t)}
            </li>
          ))}
        </ul>
      )}

      <div className="rp__done">
        <p>
          <span className="rp__donemark" aria-hidden="true">
            <Icon name="check" size={14} strokeWidth={2.8} />
          </span>
          {t("res.reached")}
        </p>
        <button type="button" className="btn btn--primary btn--block" onClick={onAgain}>
          {t("res.another")}
        </button>
      </div>
    </div>
  );
}
