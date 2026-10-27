// In-browser stand-in for the Floodline backend, enabled with ?mock=1.
// Reports, street segments and routes are computed locally from the same
// formulas and the same OpenStreetMap extract the backend uses. Events are shared
// between tabs with BroadcastChannel, so a report sent from /report?mock=1 on a
// phone-sized window appears live on the console in another tab.
import type { FloodlineApi, LiveState, NewReport } from "../lib/api";
import { FALLBACK_CATALOG, FALLBACK_VEHICLES } from "../lib/catalog";
import { assess, CALIBRATION_FITTED, calibrate, COMBINE_FACTOR, combine } from "../lib/passability";
import type { LiveEvent, Reading, Report, TriageFacts } from "../lib/types";
import { build, LATE_SPEC, reportId, score, SPECS } from "./data";
import { fuse, Roads, segmentsGeoJSON } from "./engine";

const MOCK_SOURCES = {
  "osm-hue": {
    title: "OpenStreetMap street network, Huế",
    url: "https://www.openstreetmap.org/copyright",
    note: "Street segments used for fusion and routing (ODbL).",
  },
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

async function loadRoads(): Promise<Roads> {
  const raw = await import("./roads.json");
  return new Roads(raw.default as never);
}

/** Shrink the resident's photo and fake a model overlay on a canvas. */
async function photoAssets(photo: Blob): Promise<{ image: string; overlay: string; size: [number, number] }> {
  const url = URL.createObjectURL(photo);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k);
    const h = Math.round(img.naturalHeight * k);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, w, h);
    const image = c.toDataURL("image/jpeg", 0.82);
    g.filter = "saturate(0.35)";
    g.drawImage(img, 0, 0, w, h);
    g.filter = "none";
    const top = Math.round(h * 0.62);
    g.fillStyle = "rgba(30,90,255,0.38)";
    g.fillRect(0, top, w, h - top);
    g.lineWidth = 5;
    g.strokeStyle = "#fff";
    g.beginPath();
    g.moveTo(w * 0.3, top);
    g.lineTo(w * 0.7, top);
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = "rgb(0,168,232)";
    g.stroke();
    g.font = "bold 16px Helvetica, Arial, sans-serif";
    g.lineWidth = 3;
    g.strokeStyle = "#000";
    g.fillStyle = "#fff";
    g.strokeText("mock overlay", 12, 26);
    g.fillText("mock overlay", 12, 26);
    return { image, overlay: c.toDataURL("image/jpeg", 0.8), size: [w, h] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The middle frame of a clip, as a JPEG blob (falls back to a blank frame). */
async function keyFrame(video: Blob): Promise<Blob> {
  const url = URL.createObjectURL(video);
  try {
    const el = document.createElement("video");
    el.muted = true;
    el.playsInline = true;
    el.src = url;
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error("unreadable clip"));
      window.setTimeout(() => reject(new Error("timeout")), 4000);
    });
    el.currentTime = Number.isFinite(el.duration) ? el.duration / 2 : 0;
    await new Promise<void>((resolve) => {
      el.onseeked = () => resolve();
      window.setTimeout(resolve, 2000);
    });
    const c = document.createElement("canvas");
    c.width = el.videoWidth || 960;
    c.height = el.videoHeight || 540;
    c.getContext("2d")!.drawImage(el, 0, 0, c.width, c.height);
    return await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b ?? new Blob()), "image/jpeg", 0.85));
  } catch {
    const c = document.createElement("canvas");
    c.width = 960;
    c.height = 540;
    const g = c.getContext("2d")!;
    g.fillStyle = "#5f5236";
    g.fillRect(0, 0, 960, 540);
    return await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b ?? new Blob()), "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A rough stand-in for Muse Spark's fact extraction, from keywords. */
function factsFrom(text: string, depthLabel: string): TriageFacts | null {
  const t = text.toLowerCase();
  if (!t.trim()) return null;
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  const vulnerable = [
    has("già", "cụ", "ông bà") && "elderly",
    has("trẻ", "con nhỏ", "cháu") && "child",
    has("em bé", "sơ sinh") && "infant",
    has("bầu", "mang thai", "sản phụ") && "pregnant",
    has("liệt", "khuyết tật", "xe lăn") && "disabled",
    has("ốm", "bệnh") && "sick",
  ].filter(Boolean) as string[];
  const injury = has("thương", "chảy máu", "ngã", "đau", "cấp cứu");
  const trapped = has("mắc kẹt", "không ra được", "kẹt", "trên gác", "trên mái");
  const rising = has("đang lên", "nước lên", "lên nhanh") ? "yes" : "unknown";
  const count = Number(/(\d+)\s*(người|ông|bà)/.exec(t)?.[1] ?? (vulnerable.length ? 2 : 0));
  const needs = [
    (trapped || has("thuyền", "xuồng")) && "boat",
    injury && "medical",
    has("sơ tán", "đưa đi") && "evacuation",
    has("đói", "ăn") && "food",
    has("nước uống") && "water",
  ].filter(Boolean) as string[];
  const summary = text.trim().replace(/\s+/g, " ").slice(0, 120);
  return {
    people_count: count,
    vulnerable,
    injury_or_medical: injury,
    water_rising: rising,
    trapped,
    needs: needs.length ? needs : ["info"],
    address_hint: "",
    summary_vi: summary,
    dispatch_vi: `${summary} Mực nước đo được: ${depthLabel}.`,
  };
}

export function createMockApi(): FloodlineApi {
  const now = () => Date.now() / 1000;
  let reports: Report[] = SPECS.map((s) => build(s, now())).sort((a, b) => b.at - a.at);
  let lateSent = false;
  const listeners = new Set<(e: LiveEvent) => void>();
  const roads = loadRoads();
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("floodline-mock") : null;

  const apply = (e: LiveEvent) => {
    if (e.type === "reports.reset") reports = [];
    else if (e.type === "report.created") reports = [e.data, ...reports.filter((r) => r.id !== e.data.id)];
    else reports = reports.map((r) => (r.id === e.data.id ? e.data : r));
    reports.sort((a, b) => b.at - a.at);
  };
  const emit = (e: LiveEvent, broadcast = true) => {
    apply(e);
    listeners.forEach((l) => l(e));
    if (broadcast) channel?.postMessage(e);
  };
  channel?.addEventListener("message", (m: MessageEvent<LiveEvent>) => emit(m.data, false));

  const states = async () => fuse(reports, await roads, FALLBACK_VEHICLES, now());

  return {
    async health() {
      return { ok: true, mode: "mock", has_key: false, reports: reports.length };
    },
    async catalog() {
      return { ...FALLBACK_CATALOG, sources: MOCK_SOURCES };
    },
    async reports() {
      await sleep(250);
      return [...reports];
    },
    async segments() {
      return segmentsGeoJSON(await roads, await states());
    },
    async route(from, to, vehicle) {
      const r = await roads;
      const s = await states();
      const blocked = new Set<string>();
      const risky = new Set<string>();
      for (const [id, st] of s) {
        if (st.statuses[vehicle] === "impassable") blocked.add(id);
        if (st.statuses[vehicle] === "risky") risky.add(id);
      }
      await sleep(200);
      const found = r.route(from, to, blocked, risky);
      const naive = r.route(from, to);
      if (!found) return { vehicle, route: null, naive, reason: "every way is blocked for this vehicle" };
      return {
        vehicle,
        route: found,
        naive,
        naive_blocked: (naive?.segments ?? []).filter((id) => blocked.has(id)),
      };
    },
    async setStatus(id, status) {
      const current = reports.find((r) => r.id === id);
      if (!current) throw new Error("not found");
      const updated = { ...current, status };
      emit({ type: "report.updated", data: updated });
      return updated;
    },
    async createReport(input: NewReport, signal?: AbortSignal) {
      if (!navigator.onLine) throw new TypeError("offline");
      const clip = Boolean(input.video);
      await sleep(clip ? 16000 : 9500 + Math.random() * 2500, signal);
      const still = input.video ? await keyFrame(input.video) : input.photo;
      if (!still) throw new Error("no photo");
      const assets = await photoAssets(still);
      const mean = 0.3 + Math.random() * 0.5;
      const raw: Reading[] = [
        { source: "landmark:person#1", low_m: mean - 0.08, high_m: mean + 0.1, note: "knee" },
        { source: "fraction:person#1", low_m: mean - 0.18, high_m: mean + 0.2, note: "0.30" },
        { source: "spark:holistic", low_m: mean - 0.15, high_m: mean + 0.15, note: "Spark's own range" },
      ].map((x) => ({ ...x, low_m: Math.max(0, Math.round(x.low_m * 100) / 100), high_m: Math.round(x.high_m * 100) / 100 }));
      const working = calibrate(raw);
      const readings = working.map(({ sd: _sd, ...r }) => r);
      const estimate = combine(working, 3, COMBINE_FACTOR)!;
      const words = [input.note, input.audio ? "(ghi âm)" : ""].join(" ").trim();
      const facts = factsFrom(input.note, `${estimate.low_m.toFixed(2)}–${estimate.high_m.toFixed(2)} m`);
      const [priority, reasons] = score(facts, estimate.mean_m);
      const at = now();
      const report: Report = {
        id: reportId(at),
        lat: input.lat,
        lon: input.lon,
        at,
        note: input.note,
        source: input.source ?? "web",
        status: "new",
        transcript: input.audio ? "(Bản ghi âm — chế độ mock không chuyển giọng nói thành văn bản)" : null,
        triage: { priority, reasons, facts },
        analysis: {
          size: assets.size,
          perception: {
            is_flood_photo: true,
            water_visible: true,
            setting: "street",
            quality_flags: [],
            water_flow: "still",
            people: { count: 1, children_or_elderly: false, on_roof_or_upper_floor: false, signalling_for_help: false },
            summary_vi: `Ảnh ngập do người dân gửi; mực nước ước tính ${estimate.low_m.toFixed(2)}–${estimate.high_m.toFixed(2)} m.`,
          },
          objects: [
            {
              index: 0,
              label: "person",
              orientation: "front_or_back",
              landmark: "knee",
              box_px: [0, 0, assets.size[0], assets.size[1]],
              standing_in_water: true,
              sam_confidence: 0.9,
              contact: null,
              readings: readings.slice(0, 2),
            },
          ],
          estimate,
          verdicts: assess(estimate, FALLBACK_VEHICLES),
          water_fraction: 0.38,
          seconds: 11.2,
          warnings: words ? [] : ["mock mode: depth is simulated"],
          calibration: CALIBRATION_FITTED,
        },
        image_url: assets.image,
        overlay_url: assets.overlay,
      };
      if (input.video) {
        // Mock clip: the resident's own video stands in for the tracking overlay.
        const frames = Array.from({ length: 60 }, (_, i) => Math.round((mean + 0.12 + 0.04 * Math.sin(i / 6)) * 1000) / 1000);
        report.video_url = URL.createObjectURL(input.video);
        report.analysis = {
          ...report.analysis,
          kind: "clip",
          fps: 10,
          frames: 240,
          key_frame: 120,
          objects: [{ ...report.analysis.objects[0], frames_tracked: 180, frames_measured: frames.length, depth_by_frame: frames }],
          spark_video: {
            depth_m: { low: Math.round((mean - 0.1) * 100) / 100, high: Math.round((mean + 0.2) * 100) / 100 },
            water_flow: "slow",
            what_happens_vi: "Video mô phỏng: người dân lội qua đoạn đường ngập.",
            speech_vi: "",
          },
        };
      }
      emit({ type: "report.created", data: report });
      return report;
    },
    async demoSeed() {
      emit({ type: "reports.reset", data: {} });
      const specs = [...SPECS, LATE_SPEC].sort((a, b) => b.minutesAgo - a.minutesAgo);
      for (const [i, spec] of specs.entries()) {
        await sleep(900);
        emit({ type: "report.created", data: { ...build(spec, now()), seed: { index: i + 1, total: specs.length } } });
      }
      lateSent = true;
      return { created: specs.length };
    },
    async attribution() {
      return { photos: [], videos: [] };
    },
    async demoReset() {
      emit({ type: "reports.reset", data: {} });
      lateSent = true;
    },
    subscribe(onEvent, onState: (s: LiveState) => void) {
      listeners.add(onEvent);
      window.setTimeout(() => onState("live"), 400);
      // A new report arrives a few seconds after the console opens, as it would live.
      const t = window.setTimeout(() => {
        if (lateSent) return;
        lateSent = true;
        emit({ type: "report.created", data: build(LATE_SPEC, now()) }, false);
      }, 7000);
      return () => {
        listeners.delete(onEvent);
        window.clearTimeout(t);
      };
    },
  };
}
