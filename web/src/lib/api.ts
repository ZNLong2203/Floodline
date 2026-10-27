import type {
  AskResponse,
  AttributionData,
  Catalog,
  City,
  Health,
  LiveEvent,
  Report,
  ReportStatus,
  RouteResponse,
  SegmentCollection,
} from "./types";

export type LiveState = "connecting" | "live" | "offline";

export interface NewReport {
  city?: string;
  /** A photo, or a 10–30 s clip in `video` (sent as the `video` field instead of `photo`). */
  photo?: File | Blob | null;
  video?: File | Blob | null;
  lat: number;
  lon: number;
  note: string;
  audio?: Blob | null;
  source?: string;
}

export interface FloodlineApi {
  health(): Promise<Health>;
  cities(): Promise<City[]>;
  catalog(city?: string): Promise<Catalog>;
  reports(city?: string): Promise<Report[]>;
  createReport(input: NewReport, signal?: AbortSignal): Promise<Report>;
  setStatus(id: string, status: ReportStatus): Promise<Report>;
  segments(city?: string): Promise<SegmentCollection>;
  route(from: [number, number], to: [number, number], vehicle: string, city?: string): Promise<RouteResponse>;
  /** Replay a city's scripted flood night; reports arrive over SSE. Resolves when done. */
  demoSeed(city?: string): Promise<{ created: number }>;
  /** Clear every report of a city (emits reports.reset). */
  demoReset(city?: string): Promise<void>;
  /** Ask the Muse Spark tool-use assistant. Takes 20–40 s. */
  ask(question: string, city?: string, signal?: AbortSignal): Promise<AskResponse>;
  /** Questions with a recorded answer for this city. */
  askExamples(city?: string): Promise<string[]>;
  /** Author, licence and source of every demo photo and clip (data/demo/photos.json). */
  attribution(): Promise<AttributionData>;
  /** Subscribe to live events. Returns an unsubscribe function. */
  subscribe(onEvent: (e: LiveEvent) => void, onState: (s: LiveState) => void): () => void;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly network = false,
  ) {
    super(message);
  }
}

function query(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export const isMock: boolean = (() => {
  const v = query().get("mock");
  return v !== null && v !== "0" && v !== "false";
})();

/** Keep ?mock=1 on internal links so the demo data follows you between pages. */
export function href(path: string): string {
  return isMock ? `${path}${path.includes("?") ? "&" : "?"}mock=1` : path;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Network unavailable", null, true);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body);
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail || `HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

/** "?city=hue" (or "&city=hue"), or nothing when no city is given. */
function withCity(path: string, city?: string): string {
  if (!city) return path;
  return `${path}${path.includes("?") ? "&" : "?"}city=${encodeURIComponent(city)}`;
}

const real: FloodlineApi = {
  health: () => call("/api/health"),
  cities: () => call("/api/cities"),
  catalog: (city) => call(withCity("/api/catalog", city)),
  reports: (city) => call(withCity("/api/reports", city)),
  createReport(input, signal) {
    const form = new FormData();
    if (input.video) {
      const name = input.video instanceof File ? input.video.name : "clip.mp4";
      form.append("video", input.video, name || "clip.mp4");
    } else if (input.photo) {
      const name = input.photo instanceof File ? input.photo.name : "photo.jpg";
      form.append("photo", input.photo, name || "photo.jpg");
    }
    form.append("lat", String(input.lat));
    form.append("lon", String(input.lon));
    form.append("note", input.note);
    form.append("source", input.source ?? "web");
    if (input.city) form.append("city", input.city);
    if (input.audio) {
      const ext = input.audio.type.includes("ogg") ? "ogg" : input.audio.type.includes("mp4") ? "m4a" : "webm";
      form.append("audio", input.audio, `voice.${ext}`);
    }
    return call("/api/reports", { method: "POST", body: form, signal });
  },
  setStatus: (id, status) =>
    call(`/api/reports/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),
  segments: (city) => call(withCity("/api/segments", city)),
  route(from, to, vehicle, city) {
    const q = new URLSearchParams({
      from: `${from[0]},${from[1]}`,
      to: `${to[0]},${to[1]}`,
      vehicle,
    });
    return call(withCity(`/api/route?${q}`, city));
  },
  demoSeed: (city) => call(withCity("/api/demo/seed?reset=true", city), { method: "POST" }),
  demoReset: (city) => call<unknown>(withCity("/api/demo/reset", city), { method: "POST" }).then(() => undefined),
  ask: (question, city, signal) =>
    call("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, city }),
      signal,
    }),
  askExamples: (city) => call(withCity("/api/ask/examples", city)),
  attribution: () => call("/api/attribution"),
  subscribe(onEvent, onState) {
    onState("connecting");
    const es = new EventSource("/api/events");
    const handle = (type: LiveEvent["type"]) => (e: MessageEvent) => {
      try {
        onEvent({ type, data: JSON.parse(e.data) } as LiveEvent);
      } catch {
        /* ignore malformed events */
      }
    };
    es.addEventListener("report.created", handle("report.created"));
    es.addEventListener("report.updated", handle("report.updated"));
    es.addEventListener("reports.reset", handle("reports.reset"));
    es.onopen = () => onState("live");
    es.onerror = () => onState(es.readyState === EventSource.CLOSED ? "offline" : "connecting");
    return () => es.close();
  },
};

let mockApi: Promise<FloodlineApi> | null = null;
function mock(): Promise<FloodlineApi> {
  mockApi ??= import("../mock").then((m) => m.createMockApi());
  return mockApi;
}

/** The API in use: the real backend, or the in-browser mock with ?mock=1. */
export const api: FloodlineApi = isMock
  ? {
      health: () => mock().then((a) => a.health()),
      cities: () => mock().then((a) => a.cities()),
      catalog: (c) => mock().then((a) => a.catalog(c)),
      reports: (c) => mock().then((a) => a.reports(c)),
      createReport: (i, s) => mock().then((a) => a.createReport(i, s)),
      setStatus: (id, st) => mock().then((a) => a.setStatus(id, st)),
      segments: (c) => mock().then((a) => a.segments(c)),
      route: (f, t, v, c) => mock().then((a) => a.route(f, t, v, c)),
      demoSeed: (c) => mock().then((a) => a.demoSeed(c)),
      demoReset: (c) => mock().then((a) => a.demoReset(c)),
      ask: (q, c, s) => mock().then((a) => a.ask(q, c, s)),
      askExamples: (c) => mock().then((a) => a.askExamples(c)),
      // Credits are static data: use the backend's when it is running.
      attribution: () => call<AttributionData>("/api/attribution").catch(() => ({ photos: [], videos: [] })),
      subscribe(onEvent, onState) {
        let stop: (() => void) | null = null;
        let cancelled = false;
        onState("connecting");
        mock().then((a) => {
          if (!cancelled) stop = a.subscribe(onEvent, onState);
        });
        return () => {
          cancelled = true;
          stop?.();
        };
      },
    }
  : real;
