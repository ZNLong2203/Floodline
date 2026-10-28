import "../lib/maplibre";
import { type GeoJSONSource, Map as MLMap, Marker, NavigationControl } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { basemapStyle, localiseLabels } from "../lib/basemap";
import { defaultVehicle } from "../lib/catalog";
import { band } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { City, Report, SegmentCollection, Vehicle } from "../lib/types";
import type { LatLon } from "./LocationPicker";

const EMPTY = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;
const COLOURS = {
  light: { passable: "#1f9d5c", risky: "#e8a317", impassable: "#d7362b" },
  dark: { passable: "#38c483", risky: "#f5b73b", impassable: "#ff5a4e" },
};
const WIDTH = ["interpolate", ["exponential", 1.6], ["zoom"], 12, 1.4, 14, 3, 16, 6.5, 18, 14] as unknown as number;

interface Props {
  /** "live": the full map behind the docked form. "still": blurred texture behind the column. */
  mode: "live" | "still";
  city: City;
  where: LatLon | null;
  /** Without it the map is a still background (tablet widths). */
  onPick?(p: LatLon): void;
  /** Width of the docked form, so the city and the pin centre in the visible part. */
  padLeft: number;
  /** Width of the card on the right. */
  padRight?: number;
  /** A report the resident just sent: flown to and animated in. */
  fresh: Report | null;
  /** Bump to fly to the pin and make it pulse. */
  focusKey: number;
  /** Bump to reload reports and streets. */
  refreshKey: number;
  onVehicle?(v: Vehicle | undefined): void;
}

/** The city's live flood map behind the resident form: the same streets and reports coordinators see. */
export function ReportMap({ mode, city, where, onPick, padLeft, padRight = 0, fresh, focusKey, refreshKey, onVehicle }: Props) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const [ready, setReady] = useState(false);
  const [segments, setSegments] = useState<SegmentCollection | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [vehicle, setVehicle] = useState<string>("truck");
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const interactive = mode === "live";
  const picking = Boolean(onPick);
  const dark = document.documentElement.dataset.theme === "dark";

  useEffect(() => {
    const map = new MLMap({
      container: box.current!,
      style: basemapStyle(dark ? "dark" : "light"),
      center: [city.center[1], city.center[0]],
      zoom: city.zoom ?? 14,
      interactive,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __rpmap?: MLMap }).__rpmap = map;
    map.touchZoomRotate.disableRotation();
    if (interactive) map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.setPadding({ left: padLeft, right: padRight, top: 0, bottom: 0 });
    map.on("style.load", () => {
      localiseLabels(map);
      const c = COLOURS[dark ? "dark" : "light"];
      const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
      if (!map.getSource("segments")) map.addSource("segments", { type: "geojson", data: EMPTY });
      for (const s of ["passable", "risky", "impassable"] as const) {
        if (map.getLayer(`seg-${s}`)) continue;
        map.addLayer(
          {
            id: `seg-${s}`,
            type: "line",
            source: "segments",
            filter: ["==", ["get", "__status"], s],
            layout: { "line-cap": s === "risky" ? "butt" : "round", "line-join": "round" },
            paint: {
              "line-color": c[s],
              "line-width": WIDTH,
              "line-opacity": 0.6,
              ...(s === "risky" ? { "line-dasharray": [1.4, 0.7] } : {}),
            },
          },
          firstLabel,
        );
      }
      setReady(true);
    });
    map.on("click", (e) => pickRef.current?.([e.lngLat.lat, e.lngLat.lng]));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current!);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      // Markers die with the map: forget them so a re-created map gets fresh ones.
      pin.current = null;
      markers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The docked form covers the left: keep the city centred in what remains visible.
  useEffect(() => {
    mapRef.current?.setPadding({ left: padLeft, right: padRight, top: 0, bottom: 0 });
  }, [padLeft, padRight]);

  // Data for the city: streets coloured for the default vehicle, and the reports.
  useEffect(() => {
    let live = true;
    api
      .catalog(city.id)
      .then((c) => {
        if (!live) return;
        const id = defaultVehicle(c.vehicles);
        setVehicle(id);
        onVehicle?.(c.vehicles.find((v) => v.id === id));
      })
      .catch(() => undefined);
    api
      .segments(city.id)
      .then((s) => live && setSegments(s))
      .catch(() => undefined);
    api
      .reports(city.id)
      .then((r) => live && setReports(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.id, refreshKey]);

  // Fly to a newly chosen city.
  const cityRef = useRef(city.id);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || cityRef.current === city.id) return;
    cityRef.current = city.id;
    map.flyTo({ center: [city.center[1], city.center[0]], zoom: city.zoom ?? 14, duration: 1400, essential: true });
  }, [city]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const key = `status_${vehicle}` as const;
    (map.getSource("segments") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: (segments?.features ?? [])
        .map((f) => ({ ...f, properties: { ...f.properties, __status: f.properties[key] ?? "unknown" } }))
        .filter((f) => f.properties.__status !== "unknown"),
    } as unknown as GeoJSON.FeatureCollection);
  }, [segments, vehicle, ready]);

  // Report markers, quieter than on the console; the resident's own new report pulses in.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const all = fresh && !reports.some((r) => r.id === fresh.id) ? [...reports, fresh] : reports;
    const seen = new Set<string>();
    for (const r of all) {
      seen.add(r.id);
      let m = markers.current.get(r.id);
      if (!m) {
        const el = document.createElement("div");
        el.setAttribute("aria-hidden", "true");
        el.innerHTML = '<span class="mk__pulse"></span><span class="mk__pulse mk__pulse--2"></span><span class="mk__dot"></span>';
        m = new Marker({ element: el, anchor: "center" }).setLngLat([r.lon, r.lat]).addTo(map);
        markers.current.set(r.id, m);
      }
      const el = m.getElement();
      const p = r.triage?.priority ?? 0;
      // Toggle only our classes: maplibre positions the element through its own.
      const b = band(r.triage?.priority);
      const mine = r.id === fresh?.id;
      const want: Record<string, boolean> = {
        mk: true,
        "mk--quiet": true,
        "mk--critical": b === "critical",
        "mk--urgent": b === "urgent",
        "mk--routine": b === "routine",
        "mk--none": b === "none",
        "is-fresh": mine,
        "mk--mine": mine,
      };
      for (const [c, on] of Object.entries(want)) el.classList.toggle(c, on);
      el.style.setProperty("--s", `${Math.round(18 + p * 0.14)}px`);
      el.querySelector(".mk__dot")!.textContent = r.id === fresh?.id ? "" : String(p);
      m.setLngLat([r.lon, r.lat]);
    }
    for (const [id, m] of markers.current)
      if (!seen.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
  }, [reports, fresh]);

  // The pin the resident drags; hidden once their report is on the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!where || !interactive || !picking || fresh) {
      pin.current?.remove();
      pin.current = null;
      return;
    }
    if (!pin.current) {
      const el = document.createElement("div");
      el.className = "pinmk pinmk--big";
      el.title = t("res.yourPin");
      pin.current = new Marker({ element: el, anchor: "bottom", draggable: true }).setLngLat([where[1], where[0]]).addTo(map);
      pin.current.on("dragend", () => {
        const ll = pin.current!.getLngLat();
        pickRef.current?.([ll.lat, ll.lng]);
      });
    } else pin.current.setLngLat([where[1], where[0]]);
    const pt = map.project([where[1], where[0]]);
    const { width, height } = map.getContainer().getBoundingClientRect();
    if (pt.x < padLeft + 20 || pt.x > width - padRight - 20 || pt.y < 40 || pt.y > height - 40)
      map.easeTo({ center: [where[1], where[0]], duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where, interactive, picking, fresh]);

  // "Pick on the map": bring the pin into view and pulse it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusKey || !where) return;
    map.flyTo({ center: [where[1], where[0]], zoom: Math.max(map.getZoom(), 15.5), duration: 900 });
    const el = pin.current?.getElement();
    if (el) {
      el.classList.remove("is-calling");
      void el.offsetWidth;
      el.classList.add("is-calling");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // The report was sent: fly to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fresh) return;
    map.flyTo({ center: [fresh.lon, fresh.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 1400, essential: true });
  }, [fresh]);

  return (
    <div
      className={`rpmap rpmap--${mode} ${picking ? "is-picking" : ""}`}
      ref={box}
      role={interactive ? "application" : undefined}
      aria-label={interactive ? t("res.mapAria", { city: city.name }) : undefined}
      aria-hidden={interactive ? undefined : true}
    />
  );
}
