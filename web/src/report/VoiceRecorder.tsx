import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";

const MAX_S = 60;
const HOLD_MS = 450;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
}

function mmss(s: number): string {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

type Phase = "idle" | "starting" | "recording" | "done" | "error";

/** Tap to start and tap to stop, or hold to talk and release to stop. */
export function VoiceRecorder({ value, onChange }: { value: Blob | null; onChange(b: Blob | null): void }) {
  const [phase, setPhase] = useState<Phase>(value ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const pressAt = useRef(0);
  const stopWhenReady = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(value);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [value]);

  useEffect(
    () => () => {
      window.clearInterval(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  const stop = () => {
    window.clearInterval(timer.current);
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    else stopWhenReady.current = true;
  };

  const start = async () => {
    setError(null);
    setPhase("starting");
    stopWhenReady.current = false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const mime = pickMime();
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        const secs = (performance.now() - started.current) / 1000;
        if (secs < 0.6) {
          setPhase("idle");
          setError("Bản ghi quá ngắn. Giữ nút lâu hơn hoặc chạm một lần để bắt đầu.");
          return;
        }
        const blob = new Blob(chunks.current, { type: r.mimeType || mime || "audio/webm" });
        setDuration(secs);
        setPhase("done");
        onChange(blob);
      };
      rec.current = r;
      r.start(250);
      started.current = performance.now();
      setElapsed(0);
      setPhase("recording");
      timer.current = window.setInterval(() => {
        const t = (performance.now() - started.current) / 1000;
        setElapsed(t);
        if (t >= MAX_S) stop();
      }, 200);
      if (stopWhenReady.current) stop();
    } catch {
      setPhase("error");
      setError("Không dùng được micro. Hãy cho phép truy cập micro, hoặc gõ ghi chú bên dưới.");
    }
  };

  // Press while idle starts recording. Releasing after a long press stops it
  // (hold to talk); after a short tap it keeps going until the next tap.
  const justStarted = useRef(false);
  const onDown = () => {
    pressAt.current = performance.now();
    if (phase === "idle" || phase === "error") {
      justStarted.current = true;
      void start();
    }
  };
  const onUp = () => {
    if (justStarted.current && performance.now() - pressAt.current >= HOLD_MS) {
      justStarted.current = false;
      stop();
    }
  };
  const onClick = () => {
    if (justStarted.current) {
      justStarted.current = false;
      return;
    }
    if (phase === "recording" || phase === "starting") stop();
  };

  const remove = () => {
    audio.current?.pause();
    setPlaying(false);
    setProgress(0);
    setPhase("idle");
    onChange(null);
  };

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  if (!supported)
    return <div className="voice voice--off">Trình duyệt này không hỗ trợ ghi âm. Hãy gõ ghi chú bên dưới.</div>;

  if (phase === "done" && url)
    return (
      <div className="voice voice--done">
        <button type="button" className="voice__play" onClick={toggle} aria-label={playing ? "Tạm dừng" : "Nghe lại"}>
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <div className="voice__track" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="voice__time num">{mmss(duration)}</span>
        <button type="button" className="iconbtn" onClick={remove} aria-label="Xoá ghi âm">
          <Icon name="trash" size={17} />
        </button>
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            const d = Number.isFinite(a.duration) ? a.duration : duration;
            setProgress(d ? a.currentTime / d : 0);
          }}
        />
      </div>
    );

  const recording = phase === "recording" || phase === "starting";
  return (
    <div className="voice">
      <button
        type="button"
        className={`voice__btn ${recording ? "is-rec" : ""}`}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={(e) => e.buttons && onUp()}
        onClick={onClick}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={recording ? "Dừng ghi âm" : "Ghi âm lời nhắn"}
        aria-pressed={recording}
      >
        <span className="voice__icon">
          <Icon name={recording ? "stop" : "mic"} size={22} />
        </span>
        <span className="voice__text">
          {recording ? (
            <>
              <b>
                Đang ghi… <span className="num">{mmss(elapsed)}</span>
              </b>
              <small>Chạm để dừng · Tap to stop</small>
            </>
          ) : (
            <>
              <b>Ghi âm lời nhắn</b>
              <small>Chạm hoặc giữ để nói · Tap or hold to talk</small>
            </>
          )}
        </span>
        {recording && <span className="voice__level" aria-hidden="true" />}
      </button>
      {error && (
        <div className="voice__err" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
