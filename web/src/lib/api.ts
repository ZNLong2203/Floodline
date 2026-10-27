import type {
  Catalog,
  Health,
  LiveEvent,
  Report,
  ReportStatus,
  RouteResponse,
  SegmentCollection,
} from "./types";

export type LiveState = "connecting" | "live" | "offline";

export interface NewReport {
  photo: File | Blob;
  lat: number;
  lon: number;
  note: string;
  audio?: Blob | null;
  source?: string;
}

export interface FloodlineApi {
  health(): Promise<Health>;
  catalog(): Promise<Catalog>;
  reports(): Promise<Report[]>;
  createReport(input: NewReport, signal?: AbortSignal): Promise<Report>;
  setStatus(id: string, status: ReportStatus): Promise<Report>;
  segments(): Promise<SegmentCollection>;
  route(from: [number, number], to: [number, number], vehicle: string): Promise<RouteResponse>;
  /** Replay the scripted Huế flood night; reports arrive over SSE. Resolves when done. */
  demoSeed(): Promise<{ created: number }>;
  /** Clear every report (emits reports.reset). */
  demoReset(): Promise<void>;
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

const real: FloodlineApi = {
  health: () => call("/api/health"),
  catalog: () => call("/api/catalog"),
  reports: () => call("/api/reports"),
  createReport(input, signal) {
    const form = new FormData();
    const name = input.photo instanceof File ? input.photo.name : "photo.jpg";
    form.append("photo", input.photo, name || "photo.jpg");
    form.append("lat", String(input.lat));
    form.append("lon", String(input.lon));
    form.append("note", input.note);
    form.append("source", input.source ?? "web");
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
  segments: () => call("/api/segments"),
  route(from, to, vehicle) {
    const q = new URLSearchParams({
      from: `${from[0]},${from[1]}`,
      to: `${to[0]},${to[1]}`,
      vehicle,
    });
    return call(`/api/route?${q}`);
  },
  demoSeed: () => call("/api/demo/seed?reset=true", { method: "POST" }),
  demoReset: () => call<unknown>("/api/demo/reset", { method: "POST" }).then(() => undefined),
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
      catalog: () => mock().then((a) => a.catalog()),
      reports: () => mock().then((a) => a.reports()),
      createReport: (i, s) => mock().then((a) => a.createReport(i, s)),
      setStatus: (id, st) => mock().then((a) => a.setStatus(id, st)),
      segments: () => mock().then((a) => a.segments()),
      route: (f, t, v) => mock().then((a) => a.route(f, t, v)),
      demoSeed: () => mock().then((a) => a.demoSeed()),
      demoReset: () => mock().then((a) => a.demoReset()),
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
