import type { SVGProps } from "react";
import { vehicleKind } from "../lib/catalog";

const PATHS: Record<string, string> = {
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-5m0-3h.01",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  close: "M6 6l12 12M18 6 6 18",
  back: "M15 18l-6-6 6-6",
  copy: "M9 9h10v12H9zM5 15V3h10",
  check: "M5 12.5l4.5 4.5L19 7.5",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0M12 18v3",
  stop: "M7 7h10v10H7z",
  play: "M8 5.5v13l10-6.5z",
  pause: "M8 5v14m8-14v14",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  locate: "M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-4a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-13v3m0 14v3M2 12h3m14 0h3",
  alert: "M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 12 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z",
  layers: "M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5",
  flask: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  wave: "M2 12c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 17c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m1-9a3 3 0 1 0 0-6m2 15a5 5 0 0 0-3-4.6",
  chevron: "M9 6l6 6-6 6",
  wifiOff: "M2 8.5a15 15 0 0 1 5-3M22 8.5A15 15 0 0 0 11 4.6M5 12a10 10 0 0 1 4-2.2M19 12a10 10 0 0 0-3-1.9M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18",
  image: "M4 5h16v14H4zM4 15l4.5-4.5 4 4L16 11l4 4M15.5 8.5h.01",
  send: "M4 12 20 4l-6 16-3-7-7-1Z",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  video: "M3 6.5h12v11H3zM15 10.5l6-3.5v10l-6-3.5",
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.9,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

const VEHICLE_PATHS: Record<ReturnType<typeof vehicleKind>, string> = {
  walk: "M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM9 22l2.5-7.5L14 17v5m-4.5-11L11 7l3.5 2.5L17 12M11 7l-3 3.5L7 13",
  scooter:
    "M6 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm12 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8.5 16.5H15l1.5-6.5H19M16.5 10 15 5h-2M4 13.5c0-2 1.5-3.5 3.5-3.5H11l1.5 3",
  car: "M3 16v-3.5l2-5h14l2 5V16M3 16h18M3 16v2h3v-2m12 0v2h3v-2M7 12.5h.01M17 12.5h.01M5.5 12h13",
  pickup: "M2.5 16v-4l2.5-4.5h7V12h9.5v4M2.5 16h19M6.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  truck:
    "M2 17V6h11v11M13 9h4.5l3.5 4v4h-8M2 17h2m4 0h5m4 0h4M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  boat: "M3 15h18l-2.5 4.5h-13L3 15Zm9-11v11M12 5l6 8h-6",
};

export function VehicleIcon({ id, size = 18 }: { id: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={VEHICLE_PATHS[vehicleKind(id)]} />
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path d="M5 19c3.5 0 3.5-3 7-3s3.5 3 7 3 3.5-3 7-3" fill="none" stroke="#4cc3ff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M5 24c3.5 0 3.5-3 7-3s3.5 3 7 3 3.5-3 7-3" fill="none" stroke="#4cc3ff" strokeOpacity=".55" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 5v9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M12.5 8.5 16 5l3.5 3.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
