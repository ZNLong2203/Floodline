// Mock-mode port of floodline/roads.py and floodline/fusion.py, over the same
// OpenStreetMap extract (src/mock/roads.json, built by scripts/build-mock-roads.mjs).
import { assess, combine } from "../lib/passability";
import type {
  Reading,
  Report,
  RouteResult,
  SegmentCollection,
  SegmentFeature,
  SegmentStatus,
  Vehicle,
} from "../lib/types";

interface RoadsFile {
  nodes: [number, number][]; // [lat, lon]
  names: string[];
  highways: string[];
  ways: [number, number, number[]][]; // [nameIdx, highwayIdx, nodeIdx[]]
}

interface Segment {
  id: string;
  u: number;
  v: number;
  name: string;
  highway: string;
  length: number;
}

const EARTH_M = 6_371_000;
const SPEEDS: Record<string, number> = {
  trunk: 50,
  primary: 45,
  secondary: 40,
  tertiary: 35,
  unclassified: 25,
  residential: 20,
  living_street: 10,
  service: 10,
};
const RADIUS_M = 120;
const SIGMA_PER_M = 0.003;
const HALF_LIFE_H = 3;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const p1 = lat1 * r;
  const p2 = lat2 * r;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * r;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(a));
}

export class Roads {
  readonly nodes: [number, number][];
  readonly segments = new Map<string, Segment>();
  private adj = new Map<number, { to: number; seg: string }[]>();

  constructor(raw: RoadsFile) {
    this.nodes = raw.nodes;
    for (const [ni, hi, ids] of raw.ways) {
      for (let i = 1; i < ids.length; i++) {
        const a = ids[i - 1];
        const b = ids[i];
        if (a === b) continue;
        const [u, v] = a < b ? [a, b] : [b, a];
        const id = `${u}-${v}`;
        const [la, oa] = raw.nodes[u];
        const [lb, ob] = raw.nodes[v];
        this.segments.set(id, {
          id,
          u,
          v,
          name: raw.names[ni],
          highway: raw.highways[hi],
          length: haversine(la, oa, lb, ob),
        });
        this.link(u, v, id);
        this.link(v, u, id);
      }
    }
  }

  private link(a: number, b: number, seg: string) {
    let list = this.adj.get(a);
    if (!list) this.adj.set(a, (list = []));
    if (!list.some((e) => e.to === b)) list.push({ to: b, seg });
  }

  nearbySegments(lat: number, lon: number, radius: number): [string, number][] {
    const k = Math.cos((lat * Math.PI) / 180);
    const f = (EARTH_M * Math.PI) / 180;
    const xy = (p: [number, number]) => [(p[1] - lon) * k * f, (p[0] - lat) * f];
    const out: [string, number][] = [];
    for (const s of this.segments.values()) {
      const [ax, ay] = xy(this.nodes[s.u]);
      const [bx, by] = xy(this.nodes[s.v]);
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / Math.max(dx * dx + dy * dy, 1e-9)));
      const d = Math.hypot(ax + dx * t, ay + dy * t);
      if (d <= radius) out.push([s.id, d]);
    }
    return out.sort((a, b) => a[1] - b[1]);
  }

  nearestNode(lat: number, lon: number): number {
    const k = Math.cos((lat * Math.PI) / 180);
    let best = -1;
    let bestD = Infinity;
    for (const n of this.adj.keys()) {
      const [la, lo] = this.nodes[n];
      const d = ((lo - lon) * k) ** 2 + (la - lat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  route(
    start: [number, number],
    end: [number, number],
    blocked = new Set<string>(),
    risky = new Set<string>(),
    riskyPenalty = 6,
  ): RouteResult | null {
    const s = this.nearestNode(...start);
    const t = this.nearestNode(...end);
    const dist = new Map<number, number>([[s, 0]]);
    const prev = new Map<number, { node: number; seg: string }>();
    const heap = new MinHeap();
    heap.push(0, s);
    while (heap.size) {
      const [d, n] = heap.pop()!;
      if (n === t) break;
      if (d > (dist.get(n) ?? Infinity)) continue;
      for (const e of this.adj.get(n) ?? []) {
        if (blocked.has(e.seg)) continue;
        const seg = this.segments.get(e.seg)!;
        const secs = seg.length / ((SPEEDS[seg.highway] ?? 20) / 3.6);
        const nd = d + secs * (risky.has(e.seg) ? riskyPenalty : 1);
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { node: n, seg: e.seg });
          heap.push(nd, e.to);
        }
      }
    }
    if (!dist.has(t)) return null;
    const path = [t];
    const segs: string[] = [];
    let cur = t;
    while (cur !== s) {
      const p = prev.get(cur)!;
      segs.push(p.seg);
      path.push(p.node);
      cur = p.node;
    }
    path.reverse();
    segs.reverse();
    const length = segs.reduce((a, id) => a + this.segments.get(id)!.length, 0);
    return {
      coordinates: path.map((n) => [this.nodes[n][1], this.nodes[n][0]]),
      segments: segs,
      length_m: Math.round(length * 10) / 10,
      risky_segments: segs.filter((id) => risky.has(id)),
    };
  }

  feature(id: string, props: Record<string, unknown>): SegmentFeature {
    const s = this.segments.get(id)!;
    const [la, oa] = this.nodes[s.u];
    const [lb, ob] = this.nodes[s.v];
    return {
      type: "Feature",
      id,
      geometry: { type: "LineString", coordinates: [[oa, la], [ob, lb]] },
      properties: { id, name: s.name, ...props } as SegmentFeature["properties"],
    };
  }
}

class MinHeap {
  private a: [number, number][] = [];
  get size() {
    return this.a.length;
  }
  push(k: number, v: number) {
    const a = this.a;
    a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export interface SegmentState {
  props: Record<string, unknown>;
  statuses: Record<string, SegmentStatus>;
}

/** floodline/fusion.py: depth and passability for every segment near a report. */
export function fuse(
  reports: Report[],
  roads: Roads,
  vehicles: Vehicle[],
  now: number,
): Map<string, SegmentState> {
  const bySegment = new Map<string, { r: Report; d: number }[]>();
  for (const r of reports) {
    if (!r.analysis.estimate) continue;
    for (const [id, d] of roads.nearbySegments(r.lat, r.lon, RADIUS_M)) {
      let list = bySegment.get(id);
      if (!list) bySegment.set(id, (list = []));
      list.push({ r, d });
    }
  }
  const out = new Map<string, SegmentState>();
  for (const [id, items] of bySegment) {
    const readings: Reading[] = items.map(({ r, d }) => {
      const e = r.analysis.estimate!;
      const ageH = Math.max(0, (now - r.at) / 3600);
      const sigma = Math.hypot(e.sigma_m, SIGMA_PER_M * d) * 2 ** (ageH / HALF_LIFE_H);
      return {
        source: `report:${r.id}`,
        low_m: Math.max(0, e.mean_m - 2 * sigma),
        high_m: e.mean_m + 2 * sigma,
        note: `${d.toFixed(0)} m away, ${ageH.toFixed(1)} h old`,
      };
    });
    const est = combine(readings);
    if (!est) continue;
    const flowing = items.some(({ r }) =>
      ["slow", "fast"].includes(r.analysis.perception.water_flow ?? ""),
    );
    const verdicts = assess(est, vehicles, flowing);
    const statuses: Record<string, SegmentStatus> = {};
    const props: Record<string, unknown> = {
      depth_m: Math.round(est.mean_m * 100) / 100,
      low_m: Math.round(est.low_m * 100) / 100,
      high_m: Math.round(est.high_m * 100) / 100,
      reports: items.map(({ r }) => r.id),
    };
    for (const v of verdicts) {
      statuses[v.vehicle] = v.status;
      props[`status_${v.vehicle}`] = v.status;
      props[`p_${v.vehicle}`] = v.p_exceed;
    }
    out.set(id, { props, statuses });
  }
  return out;
}

export function segmentsGeoJSON(roads: Roads, states: Map<string, SegmentState>): SegmentCollection {
  return {
    type: "FeatureCollection",
    features: [...states].map(([id, s]) => roads.feature(id, s.props)),
  };
}
