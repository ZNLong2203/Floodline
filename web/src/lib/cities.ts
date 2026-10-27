import { langCode } from "./i18n";
import type { City } from "./types";

/** Used until /api/cities answers (and in mock mode); mirrors the backend's Huế. */
export const FALLBACK_CITIES: City[] = [
  {
    id: "hue",
    name: "Huế",
    country: "Vietnam",
    language: "vi",
    center: [16.467, 107.585],
    zoom: 14,
    story:
      "Central Vietnam floods every October-November. In 2025, 32 of Huế's 40 communes were under 1-2 m of water; in October 2026 the city took more than 800 mm of rain in three days.",
    presets: [
      {
        name: "Central Hospital → Citadel (north)",
        name_local: "BV Trung ương Huế → Thành nội (Bắc)",
        from: [16.4628, 107.5888],
        to: [16.476, 107.579],
      },
      {
        name: "Central Hospital → Đông Ba market",
        name_local: "BV Trung ương Huế → Chợ Đông Ba",
        from: [16.4628, 107.5888],
        to: [16.4729, 107.588],
      },
      {
        name: "Huế station → Ngọ Môn gate",
        name_local: "Ga Huế → Ngọ Môn",
        from: [16.457, 107.5781],
        to: [16.4685, 107.5785],
      },
    ],
    has_scenario: true,
  },
];

/** Emergency numbers residents should see, by country. */
export function emergencyNumber(city: City | undefined): string {
  const c = (city?.country ?? "").toLowerCase();
  if (c.includes("viet")) return "112 / 114";
  return "112";
}

export function cityLang(city: City | undefined): string {
  return langCode(city?.language);
}

export function cityLabel(city: City | undefined): string {
  return city ? `${city.name}, ${city.country}` : "";
}

function km(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The nearest city to a point, and how far its centre is. */
export function nearestCity(cities: City[], p: [number, number]): { city: City; km: number } | null {
  let best: { city: City; km: number } | null = null;
  for (const c of cities) {
    const d = km(p, c.center);
    if (!best || d < best.km) best = { city: c, km: d };
  }
  return best;
}

/** Within the area a city's street network covers (generous: 25 km from the centre). */
export const CITY_RADIUS_KM = 25;

const KEY = "floodline-city";

export function savedCity(): string | null {
  const q = new URLSearchParams(window.location.search).get("city");
  if (q) return q;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveCity(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
}
