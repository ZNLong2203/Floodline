import { useEffect, useRef, useState } from "react";
import { Icon, Logo, VehicleIcon } from "../components/Icon";
import { StatusGlyph } from "../components/Status";
import { api, ApiError, href, isMock } from "../lib/api";
import { residentVehicles } from "../lib/catalog";
import { pct, STATUS } from "../lib/format";
import type { Report } from "../lib/types";
import { type LatLon, LocationPicker } from "./LocationPicker";
import { VoiceRecorder } from "./VoiceRecorder";

type Stage = { at: number; vi: string; en: string };

const PHOTO_STAGES: Stage[] = [
  { at: 0, vi: "Đang gửi ảnh…", en: "Uploading the photo…" },
  { at: 1.5, vi: "Muse Spark đang đọc ảnh…", en: "Muse Spark is reading the photo…" },
  { at: 5.5, vi: "SAM 3.1 đang tách vùng nước…", en: "SAM 3.1 is segmenting the water…" },
  { at: 10, vi: "Đang đo mực nước…", en: "Measuring the waterline…" },
  { at: 14, vi: "Đang đánh giá cho từng loại xe…", en: "Checking each vehicle…" },
  { at: 19, vi: "Sắp xong…", en: "Almost done…" },
];

// Clips take about 60–150 s: Spark watches the clip while SAM 3.1 tracks every object.
const CLIP_STAGES: Stage[] = [
  { at: 0, vi: "Đang gửi video…", en: "Uploading the clip…" },
  { at: 4, vi: "Muse Spark đang xem video…", en: "Muse Spark is watching the clip…" },
  { at: 15, vi: "SAM 3.1 đang theo dõi từng vật qua các khung hình…", en: "SAM 3.1 is tracking each object across the frames…" },
  { at: 55, vi: "Đang đo mực nước trên từng khung hình…", en: "Measuring the waterline frame by frame…" },
  { at: 95, vi: "Đang tổng hợp và đánh giá từng loại xe…", en: "Combining the frames and checking each vehicle…" },
  { at: 135, vi: "Sắp xong…", en: "Almost done…" },
];

type Phase = "form" | "sending" | "done" | "error";

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
  // The photo or the clip, whichever the resident chose.
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [clipSeconds, setClipSeconds] = useState<number | null>(null);
  const isVideo = Boolean(photo?.type.startsWith("video/"));
  const [where, setWhere] = useState<LatLon | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<{ title: string; body: string; network?: boolean; detail?: string } | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const recorder = useRef<HTMLInputElement>(null);
  const online = useOnline();

  useEffect(() => {
    document.title = "Báo cáo ngập · Floodline Huế";
  }, []);

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
    const t = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 200);
    return () => window.clearInterval(t);
  }, [phase]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setPhoto(f);
      setClipSeconds(null);
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
          note: note.trim(),
          audio,
          source: "web",
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
        setError({ title: "Máy chủ phản hồi quá lâu", body: "Ảnh và ghi chú của bạn vẫn còn. Bấm Thử lại sau ít phút." });
      } else if ((e instanceof ApiError && e.network) || e instanceof TypeError || !navigator.onLine) {
        setError({
          title: "Không gửi được báo cáo",
          body: "Mạng yếu hoặc mất kết nối. Ảnh và ghi chú của bạn vẫn được giữ — khi có sóng, bấm Thử lại.",
          network: true,
        });
      } else if (e instanceof ApiError && e.status === 503) {
        // The demo server replays recorded model answers only.
        setError({
          title: isVideo ? "Chưa phân tích được video này" : "Chưa phân tích được ảnh này",
          body: "Máy chủ demo chỉ phát lại các kết quả đã ghi sẵn, và ảnh này chưa có. Hãy thử một ảnh mẫu, hoặc thử lại sau.",
          detail: err.message,
        });
      } else if (e instanceof ApiError && e.status && e.status < 500) {
        setError({ title: "Ảnh không hợp lệ", body: `Máy chủ không nhận ảnh này (${err.message}). Hãy chụp lại.` });
      } else {
        setError({ title: "Máy chủ đang bận", body: "Hệ thống đang quá tải. Ảnh của bạn vẫn còn — bấm Thử lại sau ít phút." });
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
    setAudio(null);
    setNote("");
    setResult(null);
    setError(null);
    setPhase("form");
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="rp">
      <header className="rp__head">
        <a href={href("/report")} className="rp__brand" aria-label="Floodline">
          <Logo size={28} />
          <span className="wordmark">Floodline</span>
        </a>
        <span className="rp__city">
          Huế{isMock && <span className="mocktag">MOCK</span>}
        </span>
      </header>

      {!online && (
        <div className="rp__offline" role="status">
          <Icon name="wifiOff" size={16} /> Bạn đang ngoại tuyến. Có thể chuẩn bị báo cáo, rồi gửi khi có mạng.
        </div>
      )}

      {phase === "form" && (
        <main className="rp__main">
          <div className="rp__intro">
            <h1>Báo cáo điểm ngập</h1>
            <p>
              Chụp ảnh hoặc quay video nước ngập có xe máy, ô tô hoặc người đứng trong nước. Floodline đo độ sâu và báo cho đội
              cứu hộ.
              <small>Photograph or film the flood with a scooter, car or person in the water; we measure the depth and alert rescuers.</small>
            </p>
          </div>

          <section className="rp__step" aria-labelledby="s-photo">
            <h2 id="s-photo" className="rp__label">
              <span className="rp__n">1</span> Ảnh hoặc video <small>Photo or clip</small>
            </h2>
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
                    aria-label="Video đã quay"
                  />
                ) : (
                  <img src={preview} alt="Ảnh đã chụp" />
                )}
                {isVideo && clipSeconds != null && (clipSeconds < 8 || clipSeconds > 35) && (
                  <div className="rp__cliphint" role="status">
                    Video dài {Math.round(clipSeconds)} giây. Nên quay 10–30 giây để đo chính xác.
                    <small>Clips of 10–30 s measure best.</small>
                  </div>
                )}
                <div className="rp__previewbar">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => (isVideo ? recorder.current?.click() : camera.current?.click())}
                  >
                    <Icon name={isVideo ? "video" : "camera"} size={16} /> {isVideo ? "Quay lại" : "Chụp lại"}
                  </button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => gallery.current?.click()}>
                    <Icon name="image" size={16} /> Chọn tệp khác
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
                    <span className="camerabtn__text">Chụp ảnh nước ngập</span>
                    <span className="camerabtn__sub">Take a photo</span>
                  </button>
                  <button type="button" className="camerabtn camerabtn--video" onClick={() => recorder.current?.click()}>
                    <span className="camerabtn__icon">
                      <Icon name="video" size={30} strokeWidth={1.7} />
                    </span>
                    <span className="camerabtn__text">Quay video 10–30 giây</span>
                    <span className="camerabtn__sub">Film a short clip</span>
                  </button>
                </div>
                <button type="button" className="linkbtn rp__gallery" onClick={() => gallery.current?.click()}>
                  hoặc chọn ảnh, video có sẵn · or choose from gallery
                </button>
              </>
            )}
          </section>

          <section className="rp__step" aria-labelledby="s-loc">
            <h2 id="s-loc" className="rp__label">
              <span className="rp__n">2</span> Vị trí <small>Location</small>
            </h2>
            <LocationPicker value={where} onChange={setWhere} />
          </section>

          <section className="rp__step" aria-labelledby="s-voice">
            <h2 id="s-voice" className="rp__label">
              <span className="rp__n">3</span> Lời nhắn <small>Voice or note · optional</small>
            </h2>
            <VoiceRecorder value={audio} onChange={setAudio} />
            <label className="rp__notelabel" htmlFor="note">
              Ghi chú <small>Note</small>
            </label>
            <textarea
              id="note"
              className="rp__note"
              rows={3}
              maxLength={600}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Nhà có 2 người già, nước đang lên, cần thuyền…"
            />
          </section>

          <div className="rp__submitbar">
            <button type="button" className="btn btn--primary btn--xl btn--block" disabled={!photo || !where} onClick={submit}>
              <Icon name="send" size={18} /> Gửi báo cáo
              <small>Send report</small>
            </button>
            {(!photo || !where) && (
              <div className="rp__missing">
                {!photo ? "Cần có ảnh hoặc video" : "Cần có vị trí"} để gửi ·{" "}
                {!photo ? "A photo or clip is needed" : "A location is needed"}
              </div>
            )}
          </div>
        </main>
      )}

      {phase === "sending" && <Sending elapsed={elapsed} preview={preview} video={isVideo} onCancel={cancel} />}

      {phase === "error" && error && (
        <main className="rp__main">
          <div className="rp__error" role="alert">
            <Icon name={error.network ? "wifiOff" : "alert"} size={30} />
            <h1>{error.title}</h1>
            <p>{error.body}</p>
            {error.detail && <p className="rp__errdetail">{error.detail}</p>}
            <button type="button" className="btn btn--primary btn--xl btn--block" onClick={submit}>
              <Icon name="refresh" size={18} /> Thử lại <small>Try again</small>
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={() => setPhase("form")}>
              Sửa báo cáo
            </button>
          </div>
          <p className="rp__safety">
            Nếu có nguy hiểm đến tính mạng, hãy gọi <a href="tel:112">112</a> (cứu nạn) hoặc <a href="tel:114">114</a>.
          </p>
        </main>
      )}

      {phase === "done" && result && <Result report={result} onAgain={reset} />}
    </div>
  );
}

function Sending({
  elapsed,
  preview,
  video,
  onCancel,
}: {
  elapsed: number;
  preview: string | null;
  video: boolean;
  onCancel(): void;
}) {
  const STAGES = video ? CLIP_STAGES : PHOTO_STAGES;
  const idx = STAGES.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);
  const progress = Math.min(0.96, 1 - Math.exp(-elapsed / (video ? 50 : 8)));
  return (
    <main className="rp__main rp__sending" aria-live="polite">
      <div className="scan">
        {preview && (video ? <video src={preview} muted autoPlay loop playsInline /> : <img src={preview} alt="" />)}
        <div className="scan__line" />
      </div>
      <div className="stages">
        {STAGES.slice(0, -1).map((s, i) => (
          <div key={s.en} className={`stage ${i < idx ? "is-done" : i === idx ? "is-now" : ""}`}>
            <span className="stage__mark">{i < idx ? <Icon name="check" size={14} strokeWidth={2.6} /> : i === idx ? <span className="spinner spinner--sm" /> : null}</span>
            <span>
              {s.vi}
              <small>{s.en}</small>
            </span>
          </div>
        ))}
        {idx === STAGES.length - 1 && (
          <div className="stage is-now">
            <span className="stage__mark">
              <span className="spinner spinner--sm" />
            </span>
            <span>
              {STAGES[idx].vi}
              <small>{STAGES[idx].en}</small>
            </span>
          </div>
        )}
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <p className="muted rp__wait">
        {video ? "Video thường mất 1–2,5 phút · Clips take 1–2.5 minutes" : "Thường mất 10–20 giây · Usually 10–20 seconds"}
      </p>
      <button type="button" className="btn btn--ghost" onClick={onCancel}>
        Huỷ
      </button>
    </main>
  );
}

function Result({ report, onAgain }: { report: Report; onAgain(): void }) {
  const a = report.analysis;
  const est = a.estimate;
  const ids = residentVehicles(a.verdicts.map((v) => v.vehicle));
  const main = ids.map((id) => a.verdicts.find((v) => v.vehicle === id)!).filter(Boolean);
  const others = a.verdicts.filter((v) => !ids.includes(v.vehicle));
  const [view, setView] = useState<"overlay" | "original">("overlay");
  const summary = report.triage?.facts?.summary_vi || a.perception?.summary_vi;

  return (
    <main className="rp__main rp__result">
      <div className="rp__sent">
        <span className="rp__sentmark">
          <Icon name="check" size={18} strokeWidth={2.6} />
        </span>
        <div>
          <b>Đã gửi tới điều phối viên</b>
          <small>Report received by the coordinators</small>
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
                    <span>{v.name_vi}:</span> <b>{STATUS[v.status].viShout}</b>
                  </div>
                  <div className="bigverdict__en">
                    Khả năng nước sâu hơn {v.limit_m.toFixed(2)} m: <b className="num">{pct(v.p_exceed)}</b>
                    <small>
                      {v.name_en}: {STATUS[v.status].en.toLowerCase()}
                    </small>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rp__depth">
            <div>
              <span className="muted">Mực nước ước tính · Estimated depth</span>
              <b className="num">
                {est.low_m.toFixed(2)}–{est.high_m.toFixed(2)} m
              </b>
            </div>
            <div className="minibar" aria-hidden="true">
              <span className="minibar__band" style={{ left: `${(est.low_m / 2) * 100}%`, width: `${((est.high_m - est.low_m) / 2) * 100}%` }} />
              <span className="minibar__mean" style={{ left: `${(Math.min(est.mean_m, 2) / 2) * 100}%` }} />
              <span className="minibar__t minibar__t--start" style={{ left: "0%" }}>0</span>
              <span className="minibar__t" style={{ left: "50%" }}>1 m</span>
              <span className="minibar__t minibar__t--end" style={{ left: "100%" }}>2 m</span>
            </div>
          </div>
        </>
      ) : (
        <div className="rp__nodepth">
          <Icon name="alert" size={22} />
          <div>
            <b>Chưa đo được mực nước từ ảnh này.</b>
            <span>
              Báo cáo vẫn đã được gửi. Nếu có thể, hãy chụp thêm một ảnh có xe máy, ô tô hoặc người đứng trong nước.
              <small>No depth could be measured; your report was still sent.</small>
            </span>
          </div>
        </div>
      )}

      <figure className="rp__figure">
        {report.video_url ? (
          <div className="rp__imgwrap">
            <video
              src={report.video_url}
              poster={report.overlay_url}
              muted
              loop
              autoPlay
              playsInline
              controls
              aria-label="SAM 3.1 theo dõi nước và các vật qua từng khung hình"
            />
            <span className="rp__clipbadge">
              <Icon name="play" size={12} /> SAM 3.1 · {a.frames ?? "?"} khung hình
            </span>
          </div>
        ) : (
          <div className="rp__imgwrap">
            <img
              src={view === "overlay" ? report.overlay_url : report.image_url}
              alt={view === "overlay" ? "Vùng nước và vật tham chiếu mô hình nhận ra" : "Ảnh gốc"}
            />
            <div className="seg seg--dark rp__imgtoggle" role="tablist">
              <button type="button" role="tab" aria-selected={view === "overlay"} className={view === "overlay" ? "is-on" : ""} onClick={() => setView("overlay")}>
                AI nhìn thấy
              </button>
              <button type="button" role="tab" aria-selected={view === "original"} className={view === "original" ? "is-on" : ""} onClick={() => setView("original")}>
                Ảnh gốc
              </button>
            </div>
          </div>
        )}
        {summary && <figcaption lang="vi">{summary}</figcaption>}
        {a.spark_video?.what_happens_vi && (
          <p className="rp__sparkwatch" lang="vi">
            <b>Muse Spark đã xem video:</b> {a.spark_video.what_happens_vi}
          </p>
        )}
      </figure>

      {others.length > 0 && (
        <ul className="rp__others">
          {others.map((v) => (
            <li key={v.vehicle} className={`tone--${STATUS[v.status].tone}`}>
              <StatusGlyph status={v.status} size={16} />
              <VehicleIcon id={v.vehicle} size={16} />
              <span>{v.name_vi}</span>
              <b>{STATUS[v.status].vi}</b>
            </li>
          ))}
        </ul>
      )}

      <p className="rp__safety">
        Không lội qua nước chảy xiết. Nếu nguy hiểm đến tính mạng, gọi <a href="tel:112">112</a>.
      </p>

      <button type="button" className="btn btn--primary btn--xl btn--block" onClick={onAgain}>
        <Icon name="camera" size={18} /> Gửi báo cáo khác <small>Send another</small>
      </button>
    </main>
  );
}
