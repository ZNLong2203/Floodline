import "../lib/maplibre";
import { Map as MLMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { basemapStyle, collapseAttribution, localiseLabels } from "../lib/basemap";

export type LatLon = [number, number];

export const HUE_SAMPLE: LatLon = [16.46894, 107.5857]; // Trần Hưng Đạo, near Thượng Tứ gate
const HUE_BOUNDS = { minLat: 16.38, maxLat: 16.56, minLon: 107.48, maxLon: 107.7 };

export function inHue([lat, lon]: LatLon): boolean {
  return lat >= HUE_BOUNDS.minLat && lat <= HUE_BOUNDS.maxLat && lon >= HUE_BOUNDS.minLon && lon <= HUE_BOUNDS.maxLon;
}

function kmFromHue([lat, lon]: LatLon): number {
  const dy = (lat - HUE_SAMPLE[0]) * 111;
  const dx = (lon - HUE_SAMPLE[1]) * 111 * Math.cos((lat * Math.PI) / 180);
  return Math.round(Math.hypot(dx, dy));
}

type Phase = "locating" | "ok" | "outside" | "denied" | "unsupported" | "manual";

export function LocationPicker({ value, onChange }: { value: LatLon | null; onChange(p: LatLon | null): void }) {
  const [phase, setPhase] = useState<Phase>("locating");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [gps, setGps] = useState<LatLon | null>(null);
  const [showMap, setShowMap] = useState(false);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setPhase("unsupported");
      return;
    }
    setPhase("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p: LatLon = [pos.coords.latitude, pos.coords.longitude];
        setGps(p);
        setAccuracy(Math.round(pos.coords.accuracy));
        if (inHue(p)) {
          setPhase("ok");
          onChange(p);
        } else {
          setPhase("outside");
          onChange(null);
        }
      },
      () => {
        setPhase("denied");
        onChange(null);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  useEffect(locate, []); // eslint-disable-line react-hooks/exhaustive-deps

  const useSample = () => {
    setPhase("manual");
    setShowMap(true);
    onChange(HUE_SAMPLE);
  };

  return (
    <div className="loc">
      {phase === "locating" && (
        <div className="loc__status">
          <span className="spinner spinner--sm" aria-hidden="true" />
          <span>
            Đang lấy vị trí… <small>Getting your location</small>
          </span>
        </div>
      )}
      {phase === "ok" && value && (
        <div className="loc__status loc__status--ok">
          <Icon name="check" size={16} />
          <span>
            Đã lấy vị trí{accuracy != null && <> · sai số ~{accuracy} m</>} <small>Location found</small>
          </span>
          <button type="button" className="linkbtn" onClick={() => setShowMap((s) => !s)}>
            {showMap ? "Ẩn bản đồ" : "Chỉnh trên bản đồ"}
          </button>
        </div>
      )}
      {phase === "manual" && value && (
        <div className="loc__status loc__status--ok">
          <Icon name="pin" size={16} />
          <span>
            Vị trí đã chọn: <span className="num">{value[0].toFixed(5)}, {value[1].toFixed(5)}</span>
            <small>Tap the map to move the pin</small>
          </span>
        </div>
      )}
      {phase === "outside" && (
        <div className="loc__notice">
          <div>
            <b>Bạn đang ở ngoài Huế{gps ? ` (cách khoảng ${kmFromHue(gps)} km)` : ""}.</b>
            <span>Bản demo chỉ có bản đồ đường phố Huế. <small>You are outside Huế; this demo covers Huế only.</small></span>
          </div>
          <button type="button" className="btn btn--primary btn--block" onClick={useSample}>
            <Icon name="pin" size={16} /> Dùng vị trí mẫu ở Huế
          </button>
        </div>
      )}
      {(phase === "denied" || phase === "unsupported") && (
        <div className="loc__notice">
          <div>
            <b>Không lấy được vị trí.</b>
            <span>
              Hãy chọn nơi bị ngập trên bản đồ. <small>Location unavailable: choose the spot on the map.</small>
            </span>
          </div>
          <div className="loc__actions">
            <button type="button" className="btn btn--primary" onClick={useSample}>
              <Icon name="pin" size={16} /> Chọn trên bản đồ
            </button>
            {phase === "denied" && (
              <button type="button" className="btn" onClick={locate}>
                <Icon name="locate" size={16} /> Thử lại
              </button>
            )}
          </div>
        </div>
      )}
      {showMap && value && <MiniMap value={value} onChange={(p) => { setPhase("manual"); onChange(p); }} />}
    </div>
  );
}

function MiniMap({ value, onChange }: { value: LatLon; onChange(p: LatLon): void }) {
  const box = useRef<HTMLDivElement>(null);
  const marker = useRef<Marker | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const map = new MLMap({
      container: box.current!,
      style: basemapStyle(theme),
      center: [value[1], value[0]],
      zoom: 15.5,
      attributionControl: { compact: true },
      dragRotate: false,
      cooperativeGestures: false,
    });
    map.touchZoomRotate.disableRotation();
    map.on("style.load", () => localiseLabels(map));
    map.once("load", () => collapseAttribution(box.current!));
    const el = document.createElement("div");
    el.className = "pinmk";
    marker.current = new Marker({ element: el, anchor: "bottom", draggable: true }).setLngLat([value[1], value[0]]).addTo(map);
    marker.current.on("dragend", () => {
      const p = marker.current!.getLngLat();
      cb.current([p.lat, p.lng]);
    });
    map.on("click", (e) => {
      marker.current!.setLngLat(e.lngLat);
      cb.current([e.lngLat.lat, e.lngLat.lng]);
    });
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    marker.current?.setLngLat([value[1], value[0]]);
  }, [value]);

  return <div className="minimap" ref={box} role="application" aria-label="Bản đồ chọn vị trí. Chạm để đặt ghim." />;
}
