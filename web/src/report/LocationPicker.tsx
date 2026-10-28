import "../lib/maplibre";
import { Map as MLMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { basemapStyle, collapseAttribution, localiseLabels } from "../lib/basemap";
import { CITY_RADIUS_KM, nearestCity } from "../lib/cities";
import { useI18n } from "../lib/i18n";
import type { City } from "../lib/types";

export type LatLon = [number, number];

type Phase = "locating" | "ok" | "outside" | "denied" | "unsupported" | "manual";

interface Props {
  cities: City[];
  city: City;
  onCity(id: string): void;
  value: LatLon | null;
  onChange(p: LatLon | null): void;
}

/** GPS first; the nearest city with a street network wins. Otherwise the user picks on a map. */
export function LocationPicker({ cities, city, onCity, value, onChange }: Props) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("locating");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [away, setAway] = useState<{ city: City; km: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  // A location can also be set from outside (a sample photo): never wipe it from here.
  const current = useRef(value);
  current.current = value;
  useEffect(() => {
    if (value && phase !== "ok" && phase !== "manual") setPhase("manual");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setPhase("unsupported");
      return;
    }
    setPhase("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p: LatLon = [pos.coords.latitude, pos.coords.longitude];
        setAccuracy(Math.round(pos.coords.accuracy));
        const near = nearestCity(cities, p);
        if (near && near.km <= CITY_RADIUS_KM) {
          onCity(near.city.id);
          setPhase("ok");
          onChange(p);
        } else {
          setAway(near);
          if (current.current) return;
          if (near) onCity(near.city.id);
          setPhase("outside");
          onChange(null);
        }
      },
      () => {
        if (current.current) return;
        setPhase("denied");
        onChange(null);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  useEffect(locate, []); // eslint-disable-line react-hooks/exhaustive-deps

  const useSample = (c: City = city) => {
    onCity(c.id);
    setPhase("manual");
    setShowMap(true);
    onChange(c.center);
  };

  const cityPicker =
    cities.length > 1 ? (
      <label className="loc__city">
        <span>{t("rp.city")}</span>
        <select
          value={city.id}
          onChange={(e) => {
            const c = cities.find((x) => x.id === e.target.value);
            if (c) useSample(c);
          }}
        >
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}, {c.country}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <div className="loc">
      {phase === "locating" && (
        <div className="loc__status">
          <span className="spinner spinner--sm" aria-hidden="true" />
          <span>{t("loc.locating")}</span>
        </div>
      )}
      {phase === "ok" && value && (
        <div className="loc__status loc__status--ok">
          <Icon name="check" size={16} />
          <span>
            {t("loc.found")} · {city.name}
            {accuracy != null && <small>{t("loc.accuracy", { m: accuracy })}</small>}
          </span>
          <button type="button" className="linkbtn" onClick={() => setShowMap((s) => !s)}>
            {showMap ? t("loc.hide") : t("loc.adjust")}
          </button>
        </div>
      )}
      {phase === "manual" && value && (
        <div className="loc__status loc__status--ok">
          <Icon name="pin" size={16} />
          <span>
            {t("loc.chosen")} · {city.name}{" "}
            <span className="num muted">
              {value[0].toFixed(4)}, {value[1].toFixed(4)}
            </span>
            <small>{t("loc.tapMove")}</small>
          </span>
        </div>
      )}
      {phase === "outside" && (
        <div className="loc__notice">
          <div>
            <b>{t("loc.outside", { km: Math.round(away?.km ?? 0).toLocaleString(lang), city: away?.city.name ?? city.name })}</b>
            <span>{t("loc.outsideSub", { list: cities.map((c) => c.name).join(", ") })}</span>
          </div>
          {cityPicker}
          <button type="button" className="btn btn--primary btn--block" onClick={() => useSample()}>
            <Icon name="pin" size={16} /> {t("loc.useSample", { city: city.name })}
          </button>
        </div>
      )}
      {(phase === "denied" || phase === "unsupported") && (
        <div className="loc__notice">
          <div>
            <b>{t("loc.denied")}</b>
            <span>{t("loc.deniedSub")}</span>
          </div>
          {cityPicker}
          <div className="loc__actions">
            <button type="button" className="btn btn--primary" onClick={() => useSample()}>
              <Icon name="pin" size={16} /> {t("loc.chooseMap")}
            </button>
            {phase === "denied" && (
              <button type="button" className="btn" onClick={locate}>
                <Icon name="locate" size={16} /> {t("common.retry")}
              </button>
            )}
          </div>
        </div>
      )}
      {phase === "manual" && cityPicker}
      {showMap && value && (
        <MiniMap
          value={value}
          label={t("loc.mapAria")}
          onChange={(p) => {
            setPhase("manual");
            onChange(p);
          }}
        />
      )}
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
      zoom: 15.5,
      attributionControl: { compact: true },
      dragRotate: false,
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
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    marker.current?.setLngLat([value[1], value[0]]);
    const m = map.current;
    if (m && !m.getBounds().contains([value[1], value[0]])) m.easeTo({ center: [value[1], value[0]] });
  }, [value]);

  return <div className="minimap" ref={box} role="application" aria-label={label} />;
}
