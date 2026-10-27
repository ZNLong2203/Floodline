import "../lib/maplibre";
import {
  AttributionControl,
  type GeoJSONSource,
  LngLatBounds,
  type MapLayerMouseEvent,
  Map as MLMap,
  Marker,
  NavigationControl,
  ScaleControl,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { StatusGlyph } from "../components/Status";
import { basemapStyle, localiseLabels } from "../lib/basemap";
import { vehicleName } from "../lib/catalog";
import { band, pct, range, STATUS, summaryOf } from "../lib/format";
import { type Key, useI18n } from "../lib/i18n";
import type { Theme } from "../lib/theme";
import type { City, Report, RouteResult, SegmentCollection, SegmentProps, SegmentStatus, Vehicle } from "../lib/types";

export const HUE_CENTER: [number, number] = [107.585, 16.465];

const COLORS = {
  light: { passable: "#1f9d5c", risky: "#e8a317", impassable: "#d7362b", casing: "#ffffff", naive: "#5d6b78", route: "#1d5fd1", routeCasing: "#ffffff" },
  dark: { passable: "#38c483", risky: "#f5b73b", impassable: "#ff5a4e", casing: "#0b1118", naive: "#9fb0c0", route: "#5b9bff", routeCasing: "#0b1118" },
};

const STOPS: [number, number][] = [[12, 2], [14, 4.4], [16, 9.5], [18, 20]];
/** Line width that scales with zoom, wider on hover (zoom must stay the top-level input). */
const WIDTH = [
  "interpolate", ["exponential", 1.6], ["zoom"],
  ...STOPS.flatMap(([z, w]) => [z, ["case", ["boolean", ["feature-state", "hover"], false], w * 1.7, w]]),
] as unknown as number;
const CASING = [
  "interpolate", ["exponential", 1.6], ["zoom"],
  ...STOPS.flatMap(([z, w]) => [z, ["case", ["boolean", ["feature-state", "hover"], false], w * 1.7 + 3, w + 2.4]]),
] as unknown as number;
const SEG_LAYERS = ["seg-passable", "seg-risky", "seg-impassable"] as const;

const EMPTY = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;

/** Small round/triangle/square badges with ✓ ! ✕, drawn once per theme. */
function statusImage(status: "passable" | "risky" | "impassable", fill: string): ImageData {
  const s = 44;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.lineWidth = 4;
  g.strokeStyle = "#fff";
  g.fillStyle = fill;
  g.beginPath();
  if (status === "passable") g.arc(22, 22, 17, 0, Math.PI * 2);
  else if (status === "risky") {
    g.moveTo(22, 4);
    g.lineTo(40, 37);
    g.lineTo(4, 37);
    g.closePath();
  } else g.roundRect(5, 5, 34, 34, 7);
  g.fill();
  g.stroke();
  g.lineWidth = 4.4;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  if (status === "passable") {
    g.moveTo(14, 22.5);
    g.lineTo(19.5, 28);
    g.lineTo(30, 16.5);
  } else if (status === "risky") {
    g.moveTo(22, 15);
    g.lineTo(22, 24.5);
    g.moveTo(22, 30.5);
    g.lineTo(22, 30.8);
  } else {
    g.moveTo(15.5, 15.5);
    g.lineTo(28.5, 28.5);
    g.moveTo(28.5, 15.5);
    g.lineTo(15.5, 28.5);
  }
  g.stroke();
  return g.getImageData(0, 0, s, s);
}

export interface RouteView {
  safe: RouteResult | null;
  naive: RouteResult | null;
  /** No safe route exists: draw the shortest road in red. */
  blocked?: boolean;
}

interface Props {
  theme: Theme;
  city: City;
  /** Reports the assistant used: drawn with a ring. */
  highlight: Set<string>;
  vehicle: string;
  vehicles: Vehicle[];
  reports: Report[];
  segments: SegmentCollection | null;
  selectedId: string | null;
  fresh: Set<string>;
  focus: { lat: number; lon: number; key: number } | null;
  onSelect(id: string): void;
  route: RouteView | null;
  endpoints: { a: [number, number] | null; b: [number, number] | null };
  picking: "a" | "b" | null;
  onPick(p: [number, number]): void;
}

interface Hover {
  x: number;
  y: number;
  props: SegmentProps;
}

export function MapView(props: Props) {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement }>());
  const ends = useRef<{ a: Marker | null; b: Marker | null }>({ a: null, b: null });

  /** Push the latest segment data into the map, with this vehicle's status at a fixed key. */
  const syncSegments = (map: MLMap) => {
    const src = map.getSource("segments") as GeoJSONSource | undefined;
    if (!src) return;
    const { segments, vehicle } = latest.current;
    const key = `status_${vehicle}` as const;
    src.setData({
      type: "FeatureCollection",
      features: (segments?.features ?? [])
        .map((f) => ({ ...f, properties: { ...f.properties, __status: (f.properties[key] ?? "unknown") as SegmentStatus } }))
        .filter((f) => f.properties.__status !== "unknown"),
    } as unknown as GeoJSON.FeatureCollection);
  };

  const syncRoute = (map: MLMap, fit: boolean) => {
    const safe = map.getSource("route-safe") as GeoJSONSource | undefined;
    const naive = map.getSource("route-naive") as GeoJSONSource | undefined;
    if (!safe || !naive) return;
    const { route } = latest.current;
    const line = (r: RouteResult | null | undefined) =>
      r && r.coordinates.length > 1
        ? ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.coordinates } } as GeoJSON.Feature)
        : EMPTY;
    safe.setData(line(route?.safe));
    naive.setData(line(route?.naive));
    const c = COLORS[latest.current.theme];
    const blocked = Boolean(route?.blocked);
    map.setPaintProperty("route-naive", "line-color", blocked ? c.impassable : c.naive);
    map.setPaintProperty("route-naive", "line-width", blocked ? 6 : 4);
    map.setPaintProperty("route-naive", "line-dasharray", blocked ? [1.2, 0.8] : [1.6, 1.4]);
    map.setPaintProperty("route-naive-casing", "line-opacity", blocked ? 0.95 : 0);
    map.setPaintProperty("route-naive-casing", "line-color", c.routeCasing);
    const all = [...(route?.safe?.coordinates ?? []), ...(route?.naive?.coordinates ?? [])];
    if (fit && all.length > 1) {
      const b = new LngLatBounds(all[0], all[0]);
      all.forEach((c) => b.extend(c));
      // Keep the route clear of the route card (top-left, 330 px) and the legend.
      const wide = map.getContainer().clientWidth > 760;
      map.fitBounds(b, {
        padding: wide ? { top: 50, bottom: 50, left: 380, right: 70 } : { top: 260, bottom: 60, left: 40, right: 40 },
        maxZoom: 16.5,
        duration: 900,
      });
    }
  };

  /** Add our sources and layers. Runs on first load and again after every basemap swap. */
  const install = (map: MLMap) => {
    const c = COLORS[latest.current.theme];
    for (const s of ["passable", "risky", "impassable"] as const) {
      if (map.hasImage(`st-${s}`)) map.removeImage(`st-${s}`);
      map.addImage(`st-${s}`, statusImage(s, c[s]), { pixelRatio: 2 });
    }
    if (!map.getSource("segments")) map.addSource("segments", { type: "geojson", data: EMPTY, promoteId: "id" });
    if (!map.getSource("route-safe")) map.addSource("route-safe", { type: "geojson", data: EMPTY });
    if (!map.getSource("route-naive")) map.addSource("route-naive", { type: "geojson", data: EMPTY });

    // Draw the water under the basemap's labels so street names stay readable.
    const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    const add = (layer: Parameters<MLMap["addLayer"]>[0], below?: string) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer, below);
    };
    add(
      {
        id: "seg-casing",
        type: "line",
        source: "segments",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.casing, "line-width": CASING, "line-opacity": 0.9 },
      },
      firstLabel,
    );
    for (const s of ["passable", "risky", "impassable"] as const) {
      add(
        {
          id: `seg-${s}`,
          type: "line",
          source: "segments",
          filter: ["==", ["get", "__status"], s],
          layout: { "line-cap": s === "risky" ? "butt" : "round", "line-join": "round" },
          paint: {
            "line-color": c[s],
            "line-width": WIDTH,
            ...(s === "risky" ? { "line-dasharray": [1.4, 0.7] } : {}),
          },
        },
        firstLabel,
      );
    }
    add({
      id: "route-naive-casing",
      type: "line",
      source: "route-naive",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": c.routeCasing, "line-width": 10, "line-opacity": 0 },
    });
    add({
      id: "route-naive",
      type: "line",
      source: "route-naive",
      layout: { "line-join": "round" },
      paint: { "line-color": c.naive, "line-width": 4, "line-dasharray": [1.6, 1.4], "line-opacity": 0.95 },
    });
    add({
      id: "route-safe-casing",
      type: "line",
      source: "route-safe",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": c.routeCasing, "line-width": 12 },
    });
    add({
      id: "route-safe",
      type: "line",
      source: "route-safe",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": c.route, "line-width": 7 },
    });
    add({
      id: "seg-icons",
      type: "symbol",
      source: "segments",
      minzoom: 15.4,
      layout: {
        "symbol-placement": "line-center",
        "icon-image": ["concat", "st-", ["get", "__status"]],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 15.4, 0.6, 18, 0.95],
        "icon-allow-overlap": false,
        "icon-padding": 10,
        "icon-rotation-alignment": "viewport",
      },
    });
    syncSegments(map);
    syncRoute(map, false);
  };

  // Create the map once.
  useEffect(() => {
    const map = new MLMap({
      container: box.current!,
      style: basemapStyle(latest.current.theme),
      center: [latest.current.city.center[1], latest.current.city.center[0]],
      zoom: latest.current.city.zoom ?? 14,
      minZoom: 11,
      maxZoom: 19,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;

    map.on("style.load", () => {
      localiseLabels(map);
      install(map);
      setReady(true);
    });

    let hoveredId: string | number | undefined;
    const clearHover = () => {
      if (hoveredId !== undefined && map.getSource("segments"))
        map.setFeatureState({ source: "segments", id: hoveredId }, { hover: false });
      hoveredId = undefined;
    };
    for (const id of SEG_LAYERS) {
      map.on("mousemove", id, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        if (hoveredId !== f.id) {
          clearHover();
          hoveredId = f.id;
          if (hoveredId !== undefined) map.setFeatureState({ source: "segments", id: hoveredId }, { hover: true });
        }
        if (!latest.current.picking) map.getCanvas().style.cursor = "help";
        setHover({ x: e.point.x, y: e.point.y, props: f.properties as SegmentProps });
      });
      map.on("mouseleave", id, () => {
        clearHover();
        if (!latest.current.picking) map.getCanvas().style.cursor = "";
        setHover(null);
      });
    }
    map.on("click", (e) => {
      if (latest.current.picking) latest.current.onPick([e.lngLat.lat, e.lngLat.lng]);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current!);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to a city when it changes.
  const cityRef = useRef(props.city.id);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || cityRef.current === props.city.id) return;
    cityRef.current = props.city.id;
    map.flyTo({ center: [props.city.center[1], props.city.center[0]], zoom: props.city.zoom ?? 14, duration: 1600, essential: true });
  }, [props.city]);

  // Swap the basemap with the theme; style.load re-installs our layers.
  const themeRef = useRef(props.theme);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || themeRef.current === props.theme) return;
    themeRef.current = props.theme;
    map.setStyle(basemapStyle(props.theme), { diff: false });
  }, [props.theme]);

  useEffect(() => {
    if (mapRef.current && ready) syncSegments(mapRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.segments, props.vehicle, ready]);

  useEffect(() => {
    if (mapRef.current && ready) syncRoute(mapRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.route, ready]);

  // Route endpoints
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const k of ["a", "b"] as const) {
      const p = props.endpoints[k];
      const existing = ends.current[k];
      if (!p) {
        existing?.remove();
        ends.current[k] = null;
        continue;
      }
      if (existing) existing.setLngLat([p[1], p[0]]);
      else {
        const el = document.createElement("div");
        el.className = `endpoint endpoint--${k}`;
        el.textContent = k.toUpperCase();
        el.setAttribute("aria-label", `${k.toUpperCase()} · ${t("route.title")}`);
        ends.current[k] = new Marker({ element: el, anchor: "bottom" }).setLngLat([p[1], p[0]]).addTo(map);
      }
    }
  }, [props.endpoints]);

  // Picking cursor
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = props.picking ? "crosshair" : "";
    box.current?.classList.toggle("is-picking", Boolean(props.picking));
  }, [props.picking]);

  // Report markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const r of props.reports) {
      seen.add(r.id);
      const p = r.triage?.priority ?? 0;
      const est = r.analysis?.estimate;
      // Toggle only our classes: maplibre keeps its own (positioning) classes on the element.
      const want: Record<string, boolean> = {
        mk: true,
        "mk--critical": band(r.triage?.priority) === "critical",
        "mk--urgent": band(r.triage?.priority) === "urgent",
        "mk--routine": band(r.triage?.priority) === "routine",
        "mk--none": band(r.triage?.priority) === "none",
        "mk--closed": r.status === "closed",
        "mk--nodepth": !est,
        "is-fresh": props.fresh.has(r.id),
        "is-selected": props.selectedId === r.id,
        "is-highlighted": props.highlight.has(r.id),
      };
      let entry = markers.current.get(r.id);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.innerHTML = '<span class="mk__pulse"></span><span class="mk__pulse mk__pulse--2"></span><span class="mk__dot"></span>';
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (latest.current.picking) return;
          latest.current.onSelect(el.dataset.id!);
        });
        const marker = new Marker({ element: el, anchor: "center" }).setLngLat([r.lon, r.lat]).addTo(map);
        entry = { marker, el };
        markers.current.set(r.id, entry);
      }
      const { el, marker } = entry;
      el.dataset.id = r.id;
      for (const [c, on] of Object.entries(want)) el.classList.toggle(c, on);
      el.style.setProperty("--s", `${Math.round(22 + p * 0.2)}px`);
      el.style.zIndex = String(props.selectedId === r.id ? 1000 : r.status === "closed" ? 1 : 10 + p);
      el.querySelector(".mk__dot")!.textContent = String(p);
      const depth = est ? range(est.low_m, est.high_m) : t("marker.noDepth");
      const summary = summaryOf(r, lang);
      el.setAttribute("aria-label", t("marker.aria", { p, depth, summary }));
      el.title = `P${p} · ${depth}\n${summary}`;
      marker.setLngLat([r.lon, r.lat]);
    }
    for (const [id, entry] of markers.current) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markers.current.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.reports, props.fresh, props.selectedId, props.highlight, lang]);

  // Fly to a report when asked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.focus) return;
    map.easeTo({ center: [props.focus.lon, props.focus.lat], zoom: Math.max(map.getZoom(), 15.3), duration: 700 });
  }, [props.focus]);

  const v = props.vehicles.find((x) => x.id === props.vehicle);
  return (
    <div className="map">
      <div ref={box} className="map__canvas" role="region" aria-label={t("map.region", { city: props.city.name })} />
      {hover && <SegmentTip hover={hover} vehicle={props.vehicle} vehicleName={vehicleName(v, lang) || props.vehicle} />}
    </div>
  );
}

function SegmentTip({ hover, vehicle, vehicleName }: { hover: Hover; vehicle: string; vehicleName: string }) {
  const { t, tn } = useI18n();
  const p = hover.props;
  const status = (p[`status_${vehicle}`] ?? "unknown") as SegmentStatus;
  const prob = p[`p_${vehicle}`] as number | undefined;
  const reports = Array.isArray(p.reports) ? p.reports : typeof p.reports === "string" ? JSON.parse(p.reports) : [];
  const flip = hover.x > 520;
  return (
    <div
      className="segtip"
      style={{ left: hover.x, top: hover.y, transform: `translate(${flip ? "calc(-100% - 14px)" : "14px"}, -50%)` }}
      role="tooltip"
    >
      <div className="segtip__name">{p.name || t("tip.unnamed")}</div>
      <div className="segtip__depth">
        <span className="num">{range(p.low_m, p.high_m)}</span>
        <span className="segtip__mean">{t("tip.mean", { m: p.depth_m?.toFixed(2) ?? "–" })}</span>
      </div>
      <div className={`segtip__status tone--${STATUS[status].tone}`}>
        <StatusGlyph status={status} />
        <span>
          {vehicleName}: {t(`status.${status}` as Key)}
        </span>
      </div>
      {prob != null && (
        <div className="segtip__p">
          {t("tip.pexceed")} <b className="num">{pct(prob)}</b>
        </div>
      )}
      <div className="segtip__foot">{tn("tip.fused", reports.length)}</div>
    </div>
  );
}
