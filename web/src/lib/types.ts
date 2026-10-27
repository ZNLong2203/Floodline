// JSON shapes returned by the Floodline API (floodline/api.py and friends).

export type ReportStatus = "new" | "acknowledged" | "dispatched" | "closed";
export type Passability = "passable" | "risky" | "impassable";
export type SegmentStatus = Passability | "unknown";

export interface Reading {
  source: string; // "scale:scooter#2", "landmark:person#1", "fraction:car#3", "spark:holistic"
  low_m: number;
  high_m: number;
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
  landmark: string;
  box_px: [number, number, number, number];
  standing_in_water: boolean;
  sam_confidence: number | null;
  contact: Contact | null;
  readings: Reading[];
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

export interface Analysis {
  size: [number, number];
  perception: Perception;
  objects: ObjectFinding[];
  estimate: Estimate | null;
  verdicts: Verdict[];
  water_fraction: number;
  seconds: number;
  warnings: string[];
}

export interface TriageFacts {
  people_count: number;
  vulnerable: string[];
  injury_or_medical: boolean;
  water_rising: "yes" | "no" | "unknown" | string;
  trapped: boolean;
  needs: string[];
  address_hint: string;
  summary_vi: string;
  dispatch_vi: string;
}

export interface Triage {
  priority: number;
  reasons: string[];
  facts: TriageFacts | null;
}

export interface Report {
  id: string;
  lat: number;
  lon: number;
  at: number; // unix seconds
  note: string;
  source: string;
  status: ReportStatus;
  transcript: string | null;
  triage: Triage | null;
  analysis: Analysis;
  image_url: string;
  overlay_url: string;
  /** Set on reports from the replayable demo scenario (real photos placed on Huế streets). */
  scenario?: string;
  /** Path under data/demo of the Wikimedia Commons photo used. */
  photo_credit?: string;
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
  | { type: "reports.reset"; data: Record<string, never> };
