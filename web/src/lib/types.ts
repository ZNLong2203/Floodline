// JSON shapes returned by the Floodline API (floodline/api.py and friends).

export type ReportStatus = "new" | "acknowledged" | "dispatched" | "closed";
export type Passability = "passable" | "risky" | "impassable";
export type SegmentStatus = Passability | "unknown";

export interface Reading {
  // "scale:scooter#2", "landmark:person#1", "fraction:car#3", "spark:holistic",
  // "closeup-landmark:person#1", "closeup-fraction:scooter#2"
  source: string;
  low_m: number;
  high_m: number;
  /** Centre of the reading; differs from the midpoint when calibration clipped the interval at 0. */
  mean_m?: number;
  /** Calibrated readings end with "; raw 0.44-0.49 m" (the catalog range before calibration). */
  note: string;
}

export interface Contact {
  top_y: number;
  waterline_y: number;
  visible_height_px: number;
  width_px: number;
  contact_fraction: number;
  columns: number;
}

export interface ObjectFinding {
  index: number;
  label: string;
  orientation: string;
  // Photo objects only (clip objects are tracked by SAM 3.1 across frames instead).
  landmark?: string;
  box_px?: [number, number, number, number];
  standing_in_water?: boolean;
  sam_confidence?: number | null;
  contact?: Contact | null;
  readings: Reading[];
  // Clip objects only.
  frames_tracked?: number;
  frames_measured?: number;
  /** Raw depth in metres on each frame where the waterline was measured. */
  depth_by_frame?: number[];
}

export interface Estimate {
  mean_m: number;
  sigma_m: number;
  low_m: number;
  high_m: number;
  used: Reading[];
  rejected: Reading[];
}

export interface Verdict {
  vehicle: string;
  name_en: string;
  name_vi: string;
  limit_m: number;
  p_exceed: number;
  status: Passability;
}

export interface Perception {
  is_flood_photo?: boolean;
  water_visible?: boolean;
  setting?: string;
  summary_vi?: string;
  quality_flags?: string[];
  water_flow?: "still" | "slow" | "fast" | "unclear" | string;
  people?: {
    count?: number;
    children_or_elderly?: boolean;
    on_roof_or_upper_floor?: boolean;
    signalling_for_help?: boolean;
  };
  references?: unknown[];
  holistic_depth_m?: { low: number; high: number };
}

export interface SparkVideo {
  depth_m?: { low: number; high: number } | null;
  water_flow?: string;
  what_happens_en?: string;
  what_happens_local?: string;
  /** Words spoken in the clip, in the original language, and in English. */
  speech?: string;
  speech_en?: string;
  /** Older payloads. */
  what_happens_vi?: string;
  speech_vi?: string;
}

export interface Analysis {
  /** "clip" for video reports; absent or "photo" for photos. */
  kind?: "photo" | "clip" | string;
  size: [number, number];
  fps?: number;
  frames?: number;
  key_frame?: number;
  spark_video?: SparkVideo;
  perception: Perception;
  objects: ObjectFinding[];
  estimate: Estimate | null;
  verdicts: Verdict[];
  water_fraction?: number;
  seconds: number;
  warnings?: string[];
  /** Date the calibration was fitted, when one was applied. */
  calibration?: string | null;
}

export interface TriageFacts {
  people_count: number;
  vulnerable: string[];
  injury_or_medical: boolean;
  water_rising: "yes" | "no" | "unknown" | string;
  trapped: boolean;
  needs: string[];
  address_hint: string;
  /** The resident's language ("vi", or a name such as "Vietnamese"). */
  language?: string;
  /** The language summary_local and dispatch_local are written in (the city's). */
  local_language?: string;
  /** The resident's words (note and transcript) translated into English. */
  message_en?: string;
  summary_en?: string;
  summary_local?: string;
  dispatch_en?: string;
  dispatch_local?: string;
  /** Older payloads. */
  summary_vi?: string;
  dispatch_vi?: string;
}

export interface Triage {
  priority: number;
  reasons: string[];
  facts: TriageFacts | null;
}

export interface Report {
  id: string;
  city?: string;
  lat: number;
  lon: number;
  at: number; // unix seconds
  note: string;
  source: string;
  status: ReportStatus;
  transcript: string | null;
  triage: Triage | null;
  analysis: Analysis;
  /** For clips: the key frame and its overlay. */
  image_url: string;
  overlay_url: string;
  /** For clips: an MP4 of the SAM 3.1 tracking, with waterlines and per-frame depth labels. */
  video_url?: string | null;
  /** Set on reports from the replayable demo scenario (real photos placed on Huế streets). */
  scenario?: string;
  /** Path under data/demo of the Wikimedia Commons photo used. */
  photo_credit?: string;
  /** On report.created events during a scenario replay. */
  seed?: { index: number; total: number };
  /** Server notes, e.g. "message not read: this demo replays recorded answers only". */
  warnings?: string[];
  /** "whatsapp" for reports that arrived as WhatsApp messages. */
  channel?: string;
  /** True until a WhatsApp sender shares a location; the report sits at the city centre meanwhile. */
  location_pending?: boolean;
}

export interface Vehicle {
  id: string;
  name_en: string;
  name_vi: string;
  max_depth_m: number;
  max_depth_flowing_m?: number | null;
  sources?: string[];
}

export interface SourceRef {
  title?: string;
  name?: string;
  url?: string;
  publisher?: string;
  note?: string;
  [key: string]: unknown;
}

export interface Catalog {
  vehicles: Vehicle[];
  objects: Record<string, { name_en?: string; name_vi?: string; [k: string]: unknown }>;
  sources: Record<string, SourceRef | string>;
}

export interface SegmentProps {
  id: string;
  name: string;
  depth_m: number;
  low_m: number;
  high_m: number;
  reports: string[];
  [key: `status_${string}`]: SegmentStatus;
  [key: `p_${string}`]: number;
}

export interface SegmentFeature {
  type: "Feature";
  id?: string | number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: SegmentProps;
}

export interface SegmentCollection {
  type: "FeatureCollection";
  features: SegmentFeature[];
}

export interface RouteResult {
  coordinates: [number, number][]; // [lon, lat]
  segments: string[];
  length_m: number;
  risky_segments: string[];
}

export interface RouteResponse {
  vehicle: string;
  route: RouteResult | null;
  naive: RouteResult | null;
  naive_blocked?: string[];
  reason?: string;
}

export interface Health {
  ok: boolean;
  mode?: string;
  has_key?: boolean;
  reports?: number;
}

export type LiveEvent =
  | { type: "report.created"; data: Report }
  | { type: "report.updated"; data: Report }
  | { type: "reports.reset"; data: { city?: string } };

/** One entry of data/demo/photos.json, served at /api/attribution. */
export interface MediaCredit {
  file: string;
  commons_page?: string | null;
  commons_title?: string | null;
  original_file_url?: string | null;
  author?: string | null;
  author_url?: string | null;
  license?: string | null;
  license_url?: string | null;
  date?: string | null;
  date_note?: string | null;
  location?: string | null;
  lat?: number | null;
  lon?: number | null;
  visible?: string | null;
  license_review?: string | null;
  personality_rights_warning?: boolean | null;
  processing?: string | null;
}

export interface AttributionData {
  retrieved?: string;
  source?: string;
  note?: string;
  photos: MediaCredit[];
  videos?: MediaCredit[];
}

export interface CityPreset {
  name: string;
  name_local?: string;
  from: [number, number]; // [lat, lon]
  to: [number, number];
}

export interface City {
  id: string;
  name: string;
  country: string;
  /** Local language, as a code or a name ("Vietnamese"). */
  language: string;
  center: [number, number]; // [lat, lon]
  zoom: number;
  story?: string;
  presets?: CityPreset[];
  has_scenario?: boolean;
  reports?: number;
  /** How many sample photos /api/samples offers for this city. */
  samples?: number;
}

/** A recorded photo a visitor can send from /report when the server has no API key. */
export interface Sample {
  path: string;
  url: string;
}

export interface AskStep {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AskResponse {
  answer: string; // markdown
  steps: AskStep[];
  route: RouteResponse | null;
  reports: string[];
  recorded?: boolean;
}
