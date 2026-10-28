import "../lib/maplibre";
import { Map as MLMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { basemapStyle, collapseAttribution, localiseLabels } from "../lib/basemap";
import { CITY_RADIUS_KM, nearestCity } from "../lib/cities";
import { useI18n } from "../lib/i18n";
import type { City } from "../lib/types";

export type LatLon = [number, number];

type Status = "idle" | "locating" | "mine" | "outside" | "unavailable";

interface Props {
  cities: City[];
  city: City;
  onCity(id: string): void;
  value: LatLon | null;
  onChange(p: LatLon): void;
}

/**
 * A small map with a pin, which starts in the chosen city. "Use my location" moves it to the
 * device's position when that is inside a demo city; otherwise the pin stays in the city.
 */
export function LocationPicker({ cities, city, onCity, value, onChange }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("idle");

  // Picking another city in the header moves the pin there: forget the old status.
  const cityRef = useRef(city.id);
  useEffect(() => {
    if (cityRef.current !== city.id) {
      cityRef.current = city.id;
      if (status !== "mine") setStatus("idle");
    }
  }, [city.id, status]);

  const useMine = () => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p: LatLon = [pos.coords.latitude, pos.coords.longitude];
        const near = nearestCity(cities, p);
        if (near && near.km <= CITY_RADIUS_KM) {
          cityRef.current = near.city.id;
          onCity(near.city.id);
          onChange(p);
          setStatus("mine");
        } else {
          setStatus("outside");
        }
      },
      () => setStatus("unavailable"),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  const hint =
    status === "locating"
      ? t("res.locating")
      : status === "mine"
        ? t("res.usingMine")
        : status === "outside"
          ? t("res.outside", { city: city.name })
          : status === "unavailable"
            ? t("res.noGps", { city: city.name })
            : t("res.pinHint");

  return (
    <div className="loc">
      {value && <MiniMap value={value} label={t("loc.mapAria")} onChange={onChange} />}
      <div className="loc__row">
        <button type="button" className="btn btn--sm" onClick={useMine} disabled={status === "locating"}>
          {status === "locating" ? <span className="spinner spinner--sm" aria-hidden="true" /> : <Icon name="locate" size={15} />}
          {t("res.useMine")}
        </button>
        <p className={`loc__hint ${status === "outside" || status === "unavailable" ? "is-note" : ""}`} role="status">
          {hint}
        </p>
      </div>
    </div>
  );
}

function MiniMap({ value, label, onChange }: { value: LatLon; label: string; onChange(p: LatLon): void }) {
  const box = useRef<HTMLDivElement>(null);
  const marker = useRef<Marker | null>(null);
  const map = useRef<MLMap | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const m = new MLMap({
      container: box.current!,
      style: basemapStyle(theme),
      center: [value[1], value[0]],
      zoom: 14.5,
      attributionControl: { compact: true },
      dragRotate: false,
      cooperativeGestures: false,
    });
    map.current = m;
    m.touchZoomRotate.disableRotation();
    m.on("style.load", () => localiseLabels(m));
    m.once("load", () => collapseAttribution(box.current!));
    const el = document.createElement("div");
    el.className = "pinmk";
    marker.current = new Marker({ element: el, anchor: "bottom", draggable: true }).setLngLat([value[1], value[0]]).addTo(m);
    marker.current.on("dragend", () => {
      const p = marker.current!.getLngLat();
      cb.current([p.lat, p.lng]);
    });
    m.on("click", (e) => {
      marker.current!.setLngLat(e.lngLat);
      cb.current([e.lngLat.lat, e.lngLat.lng]);
    });
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current!);
    return () => {
      ro.disconnect();
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    marker.current?.setLngLat([value[1], value[0]]);
    const m = map.current;
    if (m && !m.getBounds().contains([value[1], value[0]])) m.jumpTo({ center: [value[1], value[0]], zoom: 14.5 });
  }, [value]);

  return <div className="minimap" ref={box} role="application" aria-label={label} />;
}
