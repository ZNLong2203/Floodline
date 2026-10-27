// A faithful port of floodline/estimate.py and floodline/passability.py, used by
// mock mode so the demo data behaves exactly like the backend would.
import type { Estimate, Passability, Reading, Vehicle, Verdict } from "./types";

const MIN_SIGMA_M = 0.04;
export const PASSABLE_BELOW = 0.1;
export const IMPASSABLE_ABOVE = 0.6;

/** A reading as the pipeline holds it: calibrated readings carry their own sd. */
export type WorkingReading = Reading & { sd?: number };

const mean = (r: WorkingReading) => r.mean_m ?? (r.low_m + r.high_m) / 2;
const sigma = (r: WorkingReading) => r.sd ?? Math.max(MIN_SIGMA_M, (r.high_m - r.low_m) / 4);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
    Math.exp(-z * z);
  return x >= 0 ? y : 2 - y;
}

export function probAbove(est: { mean_m: number; sigma_m: number }, threshold: number): number {
  const z = (threshold - est.mean_m) / est.sigma_m;
  return 0.5 * erfc(z / Math.SQRT2);
}

export function combine(readings: WorkingReading[], madK = 3, sigmaFactor = 1): Estimate | null {
  const rs = readings.filter((r) => r.high_m >= 0 && r.high_m >= r.low_m);
  if (!rs.length) return null;
  let used = rs;
  let rejected: Reading[] = [];
  if (rs.length >= 3) {
    const centre = median(rs.map(mean));
    const mad = median(rs.map((r) => Math.abs(mean(r) - centre)));
    const scale = Math.max(1.4826 * mad, 0.08);
    used = rs.filter((r) => Math.abs(mean(r) - centre) <= madK * scale);
    rejected = rs.filter((r) => !used.includes(r));
  }
  const w = used.map((r) => 1 / sigma(r) ** 2);
  const total = w.reduce((a, b) => a + b, 0);
  const mu = used.reduce((a, r, i) => a + w[i] * mean(r), 0) / total;
  let sd = Math.sqrt(1 / total);
  if (used.length > 1) {
    const spread = Math.sqrt(used.reduce((a, r, i) => a + w[i] * (mean(r) - mu) ** 2, 0) / total);
    sd = Math.max(sd, spread);
  }
  sd *= sigmaFactor;
  const m = Math.max(0, mu);
  const s = Math.max(sd, MIN_SIGMA_M);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    mean_m: round(m),
    sigma_m: round(s),
    low_m: round(Math.max(0, m - 2 * s)),
    high_m: round(Math.max(0, m + 2 * s)),
    used: used.map(strip),
    rejected: rejected.map(strip),
  };
}

/** Drop the working sd, as the backend's to_dict does. */
function strip(r: WorkingReading): Reading {
  const { sd: _sd, ...rest } = r;
  return rest;
}

/** floodline/calibration.py with the values of data/calibration.json (fitted 2026-10-28). */
const CAL: Record<string, { bias: number; scale: number }> = {
  landmark: { bias: 0.1433, scale: 4.2687 },
  fraction: { bias: 0.1773, scale: 1.7679 },
  scale: { bias: 0.105, scale: 3.2074 },
  spark: { bias: 0.1937, scale: 2.625 },
};
export const CALIBRATION_FITTED = "2026-10-28";
export const COMBINE_FACTOR = 1.7081;

export function calibrate(readings: Reading[]): WorkingReading[] {
  return readings.map((r) => {
    const k = CAL[r.source.split(":", 1)[0]];
    if (!k) return { ...r, mean_m: round3(mean(r)) };
    const mu = mean(r) - k.bias;
    const sd = Math.max(MIN_SIGMA_M, sigma(r) * k.scale);
    return {
      source: r.source,
      low_m: round3(Math.max(0, mu - 2 * sd)),
      high_m: round3(Math.max(0, mu + 2 * sd)),
      mean_m: round3(mu),
      note: `${r.note}; raw ${r.low_m.toFixed(2)}-${r.high_m.toFixed(2)} m`.replace(/^; /, ""),
      sd,
    };
  });
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function statusFor(p: number): Passability {
  if (p < PASSABLE_BELOW) return "passable";
  if (p > IMPASSABLE_ABOVE) return "impassable";
  return "risky";
}

export function assess(
  est: { mean_m: number; sigma_m: number },
  vehicles: Vehicle[],
  flowing = false,
): Verdict[] {
  return vehicles.map((v) => {
    const limit = flowing && v.max_depth_flowing_m ? v.max_depth_flowing_m : v.max_depth_m;
    const p = probAbove(est, limit);
    return {
      vehicle: v.id,
      name_en: v.name_en,
      name_vi: v.name_vi,
      limit_m: limit,
      p_exceed: Math.round(p * 1000) / 1000,
      status: statusFor(p),
    };
  });
}
