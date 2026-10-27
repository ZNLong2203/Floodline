import { Icon, VehicleIcon } from "../components/Icon";
import { vehicleName } from "../lib/catalog";
import { distance } from "../lib/format";
import { rich, useI18n } from "../lib/i18n";
import type { RouteResponse, SegmentCollection, Vehicle } from "../lib/types";

export type LatLon = [number, number];

export interface Place {
  name: string;
  at: LatLon;
}

/** A route preset of the current city (from /api/cities). */
export interface Preset {
  id: string;
  label: string;
  from: Place;
  to: Place;
}

export interface RouteState {
  open: boolean;
  a: Place | null;
  b: Place | null;
  loading: boolean;
  result: RouteResponse | null;
  error: string | null;
}

export const ROUTE_CLOSED: RouteState = { open: false, a: null, b: null, loading: false, result: null, error: null };

interface Props {
  state: RouteState;
  vehicle: Vehicle | undefined;
  segments: SegmentCollection | null;
  presets: Preset[];
  onOpen(): void;
  onClose(): void;
  onPreset(id: string): void;
  onReset(): void;
}

function flooded(ids: string[], segments: SegmentCollection | null, vehicle: string): Set<string> {
  const out = new Set<string>();
  const byId = new Map((segments?.features ?? []).map((f) => [String(f.properties.id), f]));
  for (const id of ids) {
    const s = byId.get(id)?.properties[`status_${vehicle}`];
    if (s === "impassable" || s === "risky") out.add(id);
  }
  return out;
}

export function RoutePanel({ state, vehicle, segments, presets, onOpen, onClose, onPreset, onReset }: Props) {
  const { t, tn, lang } = useI18n();
  if (!state.open) {
    return (
      <button type="button" className="routebtn" onClick={onOpen}>
        <Icon name="route" />
        <span>{t("route.plan")}</span>
      </button>
    );
  }
  const vid = vehicle?.id ?? "";
  const vname = vehicleName(vehicle, lang);
  const res = state.result;
  const safe = res?.route ?? null;
  const naive = res?.naive ?? null;
  const naiveFlooded = flooded(naive?.segments ?? [], segments, vid);
  const safeSet = new Set(safe?.segments ?? []);
  const avoided = [...naiveFlooded].filter((id) => !safeSet.has(id)).length;
  const blocked = res?.naive_blocked?.length ?? 0;
  const avoidN = Math.max(avoided, blocked);
  const delta = safe && naive ? safe.length_m - naive.length_m : 0;
  const deltaPct = safe && naive && naive.length_m > 0 ? Math.round((delta / naive.length_m) * 100) : 0;
  const risky = safe?.risky_segments?.length ?? 0;
  const step = !state.a ? "a" : !state.b ? "b" : null;

  return (
    <section className="routecard" aria-label={t("route.title")}>
      <header className="routecard__head">
        <div className="routecard__title">
          <Icon name="route" />
          <span>{t("route.title")}</span>
          {vehicle && (
            <span className="routecard__veh">
              <VehicleIcon id={vehicle.id} size={15} /> {vname}
            </span>
          )}
        </div>
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t("route.close")}>
          <Icon name="close" size={16} />
        </button>
      </header>

      <ol className="routecard__ends">
        <li className={step === "a" ? "is-active" : ""}>
          <span className="endpoint-dot endpoint-dot--a">A</span>
          <span className="routecard__place">{state.a?.name ?? (step === "a" ? t("route.clickStart") : "–")}</span>
        </li>
        <li className={step === "b" ? "is-active" : ""}>
          <span className="endpoint-dot endpoint-dot--b">B</span>
          <span className="routecard__place">
            {state.b?.name ?? (step === "b" ? t("route.clickDest") : step === "a" ? t("route.thenDest") : "–")}
          </span>
        </li>
      </ol>

      {step && presets.length > 0 && (
        <div className="routecard__presets">
          <div className="eyebrow">{t("route.presets")}</div>
          {presets.map((p) => (
            <button key={p.id} type="button" className="preset" onClick={() => onPreset(p.id)}>
              <span>{p.from.name}</span>
              <Icon name="chevron" size={14} />
              <span>{p.to.name}</span>
            </button>
          ))}
        </div>
      )}

      {state.loading && (
        <div className="routecard__loading">
          <span className="spinner" aria-hidden="true" /> {t("route.loading")}
        </div>
      )}

      {state.error && (
        <div className="routecard__error" role="alert">
          <Icon name="alert" size={16} /> {state.error}
        </div>
      )}

      {res && !state.loading && (
        <div className="routecard__result">
          {safe ? (
            <>
              <div className="routecard__headline">
                {avoidN > 0
                  ? rich(tn("route.avoids", avoidN, { n: "{n}" }), { n: <b>{avoidN}</b> })
                  : t("route.noFlood")}
              </div>
              <div className="routecard__stats">
                <div>
                  <span className="legend-line legend-line--safe" aria-hidden="true" />
                  <span>{t("route.safeFor", { vehicle: vname })}</span>
                  <b className="num">{distance(safe.length_m)}</b>
                </div>
                {naive && (
                  <div>
                    <span className="legend-line legend-line--naive" aria-hidden="true" />
                    <span>{t("route.shortest")}</span>
                    <b className="num">{distance(naive.length_m)}</b>
                  </div>
                )}
              </div>
              {naive && delta > 5 && (
                <div className="routecard__delta">
                  {t("route.longer", { d: distance(delta), p: deltaPct })}
                  {blocked > 0 && tn("route.crosses", blocked)}.
                </div>
              )}
              {risky > 0 && (
                <div className="routecard__warn">
                  <Icon name="alert" size={15} /> {tn("route.risky", risky)}
                </div>
              )}
            </>
          ) : (
            <NoRoute vehicle={vname} naiveLength={naive?.length_m ?? null} />
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>
            <Icon name="refresh" size={14} /> {t("route.new")}
          </button>
        </div>
      )}
    </section>
  );
}

/** The strong "send a boat" state, also used by the assistant. */
export function NoRoute({ vehicle, naiveLength }: { vehicle: string; naiveLength: number | null }) {
  const { t } = useI18n();
  return (
    <div className="noroute" role="alert">
      <span className="noroute__icon" aria-hidden="true">
        <VehicleIcon id="boat" size={26} />
      </span>
      <div>
        <b>{t("noroute.title")}</b>
        {vehicle && <span>{t("noroute.for", { vehicle })}</span>}
        {naiveLength != null ? (
          <span className="noroute__naive">
            <span className="legend-line legend-line--blocked" aria-hidden="true" /> {t("noroute.naive", { d: distance(naiveLength) })}
          </span>
        ) : (
          <span className="noroute__naive">{t("noroute.cutoff")}</span>
        )}
      </div>
    </div>
  );
}
