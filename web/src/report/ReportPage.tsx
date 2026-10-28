import { useEffect, useRef, useState } from "react";
import { Icon, Logo, VehicleIcon } from "../components/Icon";
import { StatusGlyph } from "../components/Status";
import { api, ApiError, href, isMock } from "../lib/api";
import { residentVehicles, vehicleName } from "../lib/catalog";
import { emergencyNumber, FALLBACK_CITIES, saveCity, savedCity } from "../lib/cities";
import { pct, reportLang, STATUS, summaryOf, warnT } from "../lib/format";
import { type Key, LangToggle, useI18n } from "../lib/i18n";
import type { City, Report, Sample } from "../lib/types";
import { type LatLon, LocationPicker } from "./LocationPicker";
import { VoiceRecorder } from "./VoiceRecorder";

// When each stage starts, in seconds: photos take 10–20 s, clips 60–150 s.
const PHOTO_AT = [0, 1.5, 5.5, 10, 14, 19];
const CLIP_AT = [0, 4, 15, 55, 95, 135];

type Phase = "form" | "sending" | "done" | "error";
type Failure = { title: Key; body: Key; vars?: Record<string, string>; network?: boolean; detail?: string };

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
  const { t } = useI18n();
  const [cities, setCities] = useState<City[]>(FALLBACK_CITIES);
  const [cityId, setCityId] = useState<string>(() => savedCity() ?? FALLBACK_CITIES[0].id);
  const city = cities.find((c) => c.id === cityId) ?? cities[0];
  // The photo or the clip, whichever the resident chose.
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [clipSeconds, setClipSeconds] = useState<number | null>(null);
  const isVideo = Boolean(photo?.type.startsWith("video/"));
  const [where, setWhere] = useState<LatLon | null>(null);
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
    setSamples([]);
    api
      .samples(city.id)
      .then((list) => setSamples(Array.isArray(list) ? list : []))
      .catch(() => setSamples([]));
  }, [city.id]);

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
      setWhere([lat + ((i % 2) - 0.5) * 0.004, lon + (Math.floor(i / 2) - 0.5) * 0.004]);
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

  const chooseCity = (id: string) => {
    setCityId(id);
    saveCity(id);
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
        // The demo server replays recorded model answers only.
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
    setPhoto(null);
    setSample(null);
    setAudio(null);
    setNote("");
    setResult(null);
    setError(null);
    setPhase("form");
    window.scrollTo({ top: 0 });
  };

  const emergency = emergencyNumber(city);

  return (
    <div className="rp">
      <header className="rp__head">
        <a href={href("/report")} className="rp__brand" aria-label="Floodline">
          <Logo size={28} />
          <span className="wordmark">Floodline</span>
        </a>
        <span className="rp__city">
          {city.name}
          {isMock && <span className="mocktag">MOCK</span>}
        </span>
        <LangToggle className="langtoggle--dark" />
      </header>

      {!online && (
        <div className="rp__offline" role="status">
          <Icon name="wifiOff" size={16} /> {t("rp.offline")}
        </div>
      )}

      {phase === "form" && (
        <main className="rp__main">
          <div className="rp__intro">
            <h1>{t("rp.title")}</h1>
            <p>{t("rp.intro")}</p>
          </div>

          <section className="rp__step" aria-labelledby="s-photo">
            <h2 id="s-photo" className="rp__label">
              <span className="rp__n">1</span> {t("rp.step1")}
            </h2>
            {replayOnly && (
              <SampleStrip samples={samples} selected={sample} loading={sampleLoading} error={sampleError} featured onPick={pickSample} />
            )}
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
            <input ref={recorder} type="file" accept="video/*" capture="environment" hidden onChange={pick} />
            <input ref={gallery} type="file" accept="image/*,video/*" hidden onChange={pick} />
            {preview ? (
              <div className="rp__preview">
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
                    aria-label={t("rp.videoAlt")}
                  />
                ) : (
                  <img src={preview} alt={t("rp.photoAlt")} />
                )}
                {sample && <span className="rp__samplebadge">{t("rp.sampleBadge")}</span>}
                {isVideo && clipSeconds != null && (clipSeconds < 8 || clipSeconds > 35) && (
                  <div className="rp__cliphint" role="status">
                    {t("rp.clipLength", { s: Math.round(clipSeconds) })}
                  </div>
                )}
                <div className="rp__previewbar">
                  <button type="button" className="btn btn--sm" onClick={() => (isVideo ? recorder.current?.click() : camera.current?.click())}>
                    <Icon name={isVideo ? "video" : "camera"} size={16} /> {isVideo ? t("rp.retakeVideo") : t("rp.retakePhoto")}
                  </button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => gallery.current?.click()}>
                    <Icon name="image" size={16} /> {t("rp.otherFile")}
                  </button>
                  {isVideo && clipSeconds != null && <span className="rp__dur num">{Math.round(clipSeconds)} s</span>}
                </div>
              </div>
            ) : (
              <>
                <div className="capture">
                  <button type="button" className="camerabtn" onClick={() => camera.current?.click()}>
                    <span className="camerabtn__icon">
                      <Icon name="camera" size={32} strokeWidth={1.7} />
                    </span>
                    <span className="camerabtn__text">{t("rp.takePhoto")}</span>
                    <span className="camerabtn__sub">{t("rp.takePhotoSub")}</span>
                  </button>
                  <button type="button" className="camerabtn camerabtn--video" onClick={() => recorder.current?.click()}>
                    <span className="camerabtn__icon">
                      <Icon name="video" size={30} strokeWidth={1.7} />
                    </span>
                    <span className="camerabtn__text">{t("rp.takeVideo")}</span>
                    <span className="camerabtn__sub">{t("rp.takeVideoSub")}</span>
                  </button>
                </div>
                <button type="button" className="linkbtn rp__gallery" onClick={() => gallery.current?.click()}>
                  {t("rp.gallery")}
                </button>
              </>
            )}
            {!replayOnly && (
              <SampleStrip samples={samples} selected={sample} loading={sampleLoading} error={sampleError} onPick={pickSample} />
            )}
          </section>

          <section className="rp__step" aria-labelledby="s-loc">
            <h2 id="s-loc" className="rp__label">
              <span className="rp__n">2</span> {t("rp.step2")}
            </h2>
            <LocationPicker cities={cities} city={city} onCity={chooseCity} value={where} onChange={setWhere} />
          </section>

          <section className="rp__step" aria-labelledby="s-voice">
            <h2 id="s-voice" className="rp__label">
              <span className="rp__n">3</span> {t("rp.step3")} <small>{t("rp.optional")}</small>
            </h2>
            {wordsOff ? (
              <p className="rp__wordsoff">
                <Icon name="info" size={16} /> {t("rp.sampleWordsOff")}
              </p>
            ) : (
              <>
                <VoiceRecorder value={audio} onChange={setAudio} />
                <label className="rp__notelabel" htmlFor="note">
                  {t("rp.note")}
                </label>
                <textarea
                  id="note"
                  className="rp__note"
                  rows={3}
                  maxLength={600}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("rp.notePh")}
                />
              </>
            )}
          </section>

          <div className="rp__submitbar">
            <button type="button" className="btn btn--primary btn--xl btn--block" disabled={!photo || !where} onClick={submit}>
              <Icon name="send" size={18} /> {t("rp.send")}
            </button>
            {(!photo || !where) && <div className="rp__missing">{!photo ? t("rp.needMedia") : t("rp.needPlace")}</div>}
          </div>
        </main>
      )}

      {phase === "sending" && <Sending elapsed={elapsed} preview={preview} video={isVideo} onCancel={cancel} />}

      {phase === "error" && error && (
        <main className="rp__main">
          <div className="rp__error" role="alert">
            <Icon name={error.network ? "wifiOff" : "alert"} size={30} />
            <h1>{t(error.title)}</h1>
            <p>{t(error.body, error.vars)}</p>
            {error.detail && <p className="rp__errdetail">{error.detail}</p>}
            <button type="button" className="btn btn--primary btn--xl btn--block" onClick={submit}>
              <Icon name="refresh" size={18} /> {t("rp.retry")}
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={() => setPhase("form")}>
              {t("rp.edit")}
            </button>
          </div>
          <p className="rp__safety">{t("rp.emergency", { n: emergency })}</p>
        </main>
      )}

      {phase === "done" && result && <Result report={result} emergency={emergency} onAgain={reset} />}
    </div>
  );
}

function Sending({ elapsed, preview, video, onCancel }: { elapsed: number; preview: string | null; video: boolean; onCancel(): void }) {
  const { t } = useI18n();
  const at = video ? CLIP_AT : PHOTO_AT;
  const kind = video ? "clip" : "photo";
  const label = (i: number) => t(`rp.stage.${kind}.${i}` as Key);
  const idx = at.reduce((acc, s, i) => (elapsed >= s ? i : acc), 0);
  const progress = Math.min(0.96, 1 - Math.exp(-elapsed / (video ? 50 : 8)));
  const visible = at.slice(0, -1).map((_, i) => i);
  return (
    <main className="rp__main rp__sending" aria-live="polite">
      <div className="scan">
        {preview && (video ? <video src={preview} muted autoPlay loop playsInline /> : <img src={preview} alt="" />)}
        <div className="scan__line" />
      </div>
      <div className="stages">
        {visible.map((i) => (
          <div key={i} className={`stage ${i < idx ? "is-done" : i === idx ? "is-now" : ""}`}>
            <span className="stage__mark">
              {i < idx ? <Icon name="check" size={14} strokeWidth={2.6} /> : i === idx ? <span className="spinner spinner--sm" /> : null}
            </span>
            <span>{label(i)}</span>
          </div>
        ))}
        {idx === at.length - 1 && (
          <div className="stage is-now">
            <span className="stage__mark">
              <span className="spinner spinner--sm" />
            </span>
            <span>{label(idx)}</span>
          </div>
        )}
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <p className="muted rp__wait">{video ? t("rp.waitClip") : t("rp.waitPhoto")}</p>
      <button type="button" className="btn btn--ghost" onClick={onCancel}>
        {t("rp.cancel")}
      </button>
    </main>
  );
}

function Result({ report, emergency, onAgain }: { report: Report; emergency: string; onAgain(): void }) {
  const { t, lang } = useI18n();
  const a = report.analysis;
  const est = a.estimate;
  const ids = residentVehicles(a.verdicts.map((v) => v.vehicle));
  const main = ids.map((id) => a.verdicts.find((v) => v.vehicle === id)!).filter(Boolean);
  const others = a.verdicts.filter((v) => !ids.includes(v.vehicle));
  const [view, setView] = useState<"overlay" | "original">("overlay");
  const summary = summaryOf(report, lang);
  const sv = a.spark_video;
  const rl = reportLang(report);
  const watched = lang === rl ? sv?.what_happens_local || sv?.what_happens_en : sv?.what_happens_en || sv?.what_happens_local || sv?.what_happens_vi;

  return (
    <main className="rp__main rp__result">
      <div className="rp__sent">
        <span className="rp__sentmark">
          <Icon name="check" size={18} strokeWidth={2.6} />
        </span>
        <div>
          <b>{t("rp.sent")}</b>
          <small>{t("rp.sentSub")}</small>
        </div>
      </div>

      {est ? (
        <>
          <div className="bigverdicts">
            {main.map((v) => (
              <div key={v.vehicle} className={`bigverdict tone--${STATUS[v.status].tone}`}>
                <StatusGlyph status={v.status} size={30} />
                <div>
                  <div className="bigverdict__line">
                    <VehicleIcon id={v.vehicle} size={20} />
                    <span>{vehicleName(v, lang)}:</span> <b>{t(`shout.${v.status}` as Key)}</b>
                  </div>
                  <div className="bigverdict__en">{t("rp.chance", { m: v.limit_m.toFixed(2), p: pct(v.p_exceed) })}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="rp__depth">
            <div>
              <span className="muted">{t("rp.depth")}</span>
              <b className="num">
                {est.low_m.toFixed(2)}–{est.high_m.toFixed(2)} m
              </b>
            </div>
            <div className="minibar" aria-hidden="true">
              <span className="minibar__band" style={{ left: `${(Math.min(est.low_m, 2) / 2) * 100}%`, width: `${((Math.min(est.high_m, 2) - Math.min(est.low_m, 2)) / 2) * 100}%` }} />
              <span className="minibar__mean" style={{ left: `${(Math.min(est.mean_m, 2) / 2) * 100}%` }} />
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
        <div className="rp__nodepth">
          <Icon name="alert" size={22} />
          <div>
            <b>{t("rp.noDepth")}</b>
            <span>{t("rp.noDepthBody")}</span>
          </div>
        </div>
      )}

      <figure className="rp__figure">
        {report.video_url ? (
          <div className="rp__imgwrap">
            <video src={report.video_url} poster={report.overlay_url} muted loop autoPlay playsInline controls aria-label={t("clip.aria")} />
            <span className="rp__clipbadge">
              <Icon name="play" size={12} /> {t("rp.clipBadge", { n: a.frames ?? "?" })}
            </span>
          </div>
        ) : (
          <div className="rp__imgwrap">
            <img src={view === "overlay" ? report.overlay_url : report.image_url} alt={view === "overlay" ? t("photo.altOverlay") : t("photo.altOriginal")} />
            <div className="seg seg--dark rp__imgtoggle" role="tablist">
              <button type="button" role="tab" aria-selected={view === "overlay"} className={view === "overlay" ? "is-on" : ""} onClick={() => setView("overlay")}>
                {t("rp.aiSaw")}
              </button>
              <button type="button" role="tab" aria-selected={view === "original"} className={view === "original" ? "is-on" : ""} onClick={() => setView("original")}>
                {t("rp.original")}
              </button>
            </div>
          </div>
        )}
        {summary && summary !== "–" && <figcaption>{summary}</figcaption>}
        {watched && (
          <p className="rp__sparkwatch">
            <b>{t("rp.sparkWatched")}</b> {watched}
          </p>
        )}
      </figure>

      {others.length > 0 && (
        <ul className="rp__others">
          {others.map((v) => (
            <li key={v.vehicle} className={`tone--${STATUS[v.status].tone}`}>
              <StatusGlyph status={v.status} size={16} />
              <VehicleIcon id={v.vehicle} size={16} />
              <span>{vehicleName(v, lang)}</span>
              <b>{t(`status.${v.status}` as Key)}</b>
            </li>
          ))}
        </ul>
      )}

      {!!report.warnings?.length && (
        <div className="rp__warnings" role="status">
          <b>{t("rp.warnings")}</b>
          <ul>
            {report.warnings.map((w) => (
              <li key={w}>
                <Icon name="info" size={15} /> {warnT(w, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="rp__safety">
        {t("rp.noWade")} {t("rp.emergency", { n: emergency })}
      </p>

      <button type="button" className="btn btn--primary btn--xl btn--block" onClick={onAgain}>
        <Icon name="camera" size={18} /> {t("rp.again")}
      </button>
    </main>
  );
}

function SampleStrip({
  samples,
  selected,
  loading,
  error,
  featured = false,
  onPick,
}: {
  samples: Sample[];
  selected: string | null;
  loading: string | null;
  error: boolean;
  featured?: boolean;
  onPick(s: Sample, i: number): void;
}) {
  const { t } = useI18n();
  if (!samples.length) return null;
  return (
    <div className={`samples ${featured ? "samples--featured" : ""}`}>
      {featured && (
        <div className="samples__callout">
          <Icon name="flask" size={16} /> <b>{t("rp.samplesReplay")}</b>
        </div>
      )}
      <div className="samples__head">
        <b>{t("rp.samples")}</b>
        <small>{t("rp.samplesSub")}</small>
      </div>
      <div className="samples__grid">
        {samples.map((s, i) => (
          <button
            key={s.path}
            type="button"
            className={`samples__item ${selected === s.path ? "is-on" : ""}`}
            aria-pressed={selected === s.path}
            aria-label={t("rp.sampleAlt", { n: i + 1 })}
            disabled={Boolean(loading)}
            onClick={() => onPick(s, i)}
          >
            <img src={s.url} alt="" loading="lazy" />
            {loading === s.path && (
              <span className="samples__busy" aria-label={t("rp.sampleLoading")}>
                <span className="spinner spinner--sm" />
              </span>
            )}
            {selected === s.path && (
              <span className="samples__check" aria-hidden="true">
                <Icon name="check" size={14} strokeWidth={2.8} />
              </span>
            )}
          </button>
        ))}
      </div>
      {error && (
        <div className="samples__err" role="alert">
          {t("rp.sampleError")}
        </div>
      )}
    </div>
  );
}
