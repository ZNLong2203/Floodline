import type { Catalog, Vehicle } from "./types";

/**
 * Used when /api/catalog is unavailable (and in mock mode). The live catalog
 * (data/catalog.yaml on the backend) always wins when it loads.
 */
export const FALLBACK_VEHICLES: Vehicle[] = [
  { id: "pedestrian", name_en: "On foot", name_vi: "Đi bộ", max_depth_m: 0.5, max_depth_flowing_m: 0.15 },
  { id: "scooter", name_en: "Scooter", name_vi: "Xe máy", max_depth_m: 0.21, max_depth_flowing_m: 0.15 },
  { id: "car", name_en: "Car", name_vi: "Ô tô con", max_depth_m: 0.3, max_depth_flowing_m: 0.15 },
  { id: "suv", name_en: "SUV / pickup", name_vi: "Xe gầm cao", max_depth_m: 0.4, max_depth_flowing_m: 0.3 },
  { id: "truck", name_en: "Rescue truck", name_vi: "Xe tải cứu hộ", max_depth_m: 0.5, max_depth_flowing_m: 0.45 },
];

export const FALLBACK_CATALOG: Catalog = {
  vehicles: FALLBACK_VEHICLES,
  objects: {},
  sources: {},
};

export type VehicleKind = "walk" | "scooter" | "car" | "pickup" | "truck" | "boat";

/** Map a catalog vehicle id (not final on the backend) to an icon family. */
export function vehicleKind(id: string): VehicleKind {
  const s = id.toLowerCase();
  if (/(pedestrian|walk|foot|person|people)/.test(s)) return "walk";
  if (/(scooter|motor|bike|moto)/.test(s)) return "scooter";
  if (/(suv|pickup|4x4|high)/.test(s)) return "pickup";
  if (/(truck|lorry|bus|army|rescue)/.test(s)) return "truck";
  if (/(boat|canoe)/.test(s)) return "boat";
  return "car";
}

/** The vehicle a coordinator most likely wants selected when the console opens. */
export function defaultVehicle(vehicles: Vehicle[]): string {
  return (
    vehicles.find((v) => vehicleKind(v.id) === "truck")?.id ??
    vehicles.find((v) => vehicleKind(v.id) === "car")?.id ??
    vehicles[Math.min(1, vehicles.length - 1)]?.id ??
    "car"
  );
}

/** Find the verdict ids that matter most to residents: scooter and car. */
export function residentVehicles(ids: string[]): string[] {
  const scooter = ids.find((id) => vehicleKind(id) === "scooter");
  const car = ids.find((id) => vehicleKind(id) === "car");
  const picked = [scooter, car].filter((x): x is string => Boolean(x));
  return picked.length ? picked : ids.slice(0, 2);
}

const ES_VEHICLES: Record<string, string> = {
  pedestrian: "A pie",
  scooter: "Moto",
  car: "Coche",
  suv: "SUV / pickup",
  pickup: "SUV / pickup",
  truck: "Camión de rescate",
};

/** A vehicle's name in the UI language: the catalog has English and Vietnamese. */
export function vehicleName(v: { id?: string; vehicle?: string; name_en: string; name_vi: string } | undefined, lang: string): string {
  if (!v) return "";
  const id = v.id ?? v.vehicle ?? "";
  if (lang === "vi") return v.name_vi || v.name_en;
  if (lang === "es") return ES_VEHICLES[id] ?? ES_VEHICLES[vehicleKind(id)] ?? v.name_en;
  return v.name_en || v.name_vi;
}
