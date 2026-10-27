import { Icon, VehicleIcon } from "../components/Icon";
import { distance } from "../lib/format";
import type { RouteResponse, SegmentCollection, Vehicle } from "../lib/types";

export type LatLon = [number, number];

export interface Place {
  name: string;
  at: LatLon;
}

export const PRESETS: { id: string; from: Place; to: Place }[] = [
  {
    // Seeded scenario: the truck's shortest road crosses 4 impassable segments (2.3 km vs 2.1 km).
    id: "bv-thanhnoi",
    from: { name: "Bệnh viện Trung ương Huế", at: [16.4628, 107.5888] },
    to: { name: "Thành nội (Bắc)", at: [16.476, 107.579] },
  },
  {
    // Seeded scenario: no road route for any vehicle.
    id: "bv-dongba",
    from: { name: "Bệnh viện Trung ương Huế", at: [16.4627, 107.5873] },
    to: { name: "Chợ Đông Ba", at: [16.4729, 107.588] },
  },
  {
    // The truck goes straight; a car has to detour.
    id: "ga-ngomon",
    from: { name: "Ga Huế", at: [16.4566, 107.5781] },
    to: { name: "Đại Nội (Ngọ Môn)", at: [16.4697, 107.581] },
  },
];

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
  onOpen(): void;
  onClose(): void;
  onPreset(id: string): void;
  onReset(): void;
}

function floodedCount(ids: string[], segments: SegmentCollection | null, vehicle: string): Set<string> {
  const flooded = new Set<string>();
  const byId = new Map((segments?.features ?? []).map((f) => [String(f.properties.id), f]));
  for (const id of ids) {
    const s = byId.get(id)?.properties[`status_${vehicle}`];
    if (s === "impassable" || s === "risky") flooded.add(id);
  }
  return flooded;
}

export function RoutePanel({ state, vehicle, segments, onOpen, onClose, onPreset, onReset }: Props) {
  if (!state.open) {
    return (
      <button type="button" className="routebtn" onClick={onOpen}>
        <Icon name="route" />
        <span>Plan route</span>
      </button>
    );
  }
  const vid = vehicle?.id ?? "";
  const res = state.result;
  const safe = res?.route ?? null;
  const naive = res?.naive ?? null;
  const naiveFlooded = floodedCount(naive?.segments ?? [], segments, vid);
  const safeSet = new Set(safe?.segments ?? []);
  const avoided = [...naiveFlooded].filter((id) => !safeSet.has(id)).length;
  const blocked = res?.naive_blocked?.length ?? 0;
  const delta = safe && naive ? safe.length_m - naive.length_m : 0;
  const deltaPct = safe && naive && naive.length_m > 0 ? Math.round((delta / naive.length_m) * 100) : 0;
  const risky = safe?.risky_segments?.length ?? 0;
  const step = !state.a ? "a" : !state.b ? "b" : null;

  return (
    <section className="routecard" aria-label="Route planner">
      <header className="routecard__head">
        <div className="routecard__title">
          <Icon name="route" />
          <span>Safe route</span>
          {vehicle && (
            <span className="routecard__veh">
              <VehicleIcon id={vehicle.id} size={15} /> {vehicle.name_vi}
            </span>
          )}
        </div>
        <button type="button" className="iconbtn" onClick={onClose} aria-label="Close route planner">
          <Icon name="close" size={16} />
        </button>
      </header>

      <ol className="routecard__ends">
        <li className={step === "a" ? "is-active" : ""}>
          <span className="endpoint-dot endpoint-dot--a">A</span>
          <span className="routecard__place">{state.a?.name ?? (step === "a" ? "Click the start on the map" : "–")}</span>
        </li>
        <li className={step === "b" ? "is-active" : ""}>
          <span className="endpoint-dot endpoint-dot--b">B</span>
          <span className="routecard__place">
            {state.b?.name ?? (step === "b" ? "Click the destination" : step === "a" ? "then the destination" : "–")}
          </span>
        </li>
      </ol>

      {step && (
        <div className="routecard__presets">
          <div className="eyebrow">Or try a preset</div>
          {PRESETS.map((p) => (
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
          <span className="spinner" aria-hidden="true" /> Finding a way around the water…
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
                {avoided > 0 || blocked > 0 ? (
                  <>
                    Avoids <b>{Math.max(avoided, blocked)}</b> flooded segment{Math.max(avoided, blocked) === 1 ? "" : "s"}
                  </>
                ) : (
                  <>No flooding on the direct route</>
                )}
              </div>
              <div className="routecard__stats">
                <div>
                  <span className="legend-line legend-line--safe" aria-hidden="true" />
                  <span>Safe for {vehicle?.name_vi}</span>
                  <b className="num">{distance(safe.length_m)}</b>
                </div>
                {naive && (
                  <div>
                    <span className="legend-line legend-line--naive" aria-hidden="true" />
                    <span>Shortest</span>
                    <b className="num">{distance(naive.length_m)}</b>
                  </div>
                )}
              </div>
              {naive && delta > 5 && (
                <div className="routecard__delta">
                  +{distance(delta)} ({deltaPct}%) longer than the shortest route
                  {blocked > 0 && <>, which crosses {blocked} impassable segment{blocked === 1 ? "" : "s"}</>}.
                </div>
              )}
              {risky > 0 && (
                <div className="routecard__warn">
                  <Icon name="alert" size={15} /> Still crosses {risky} risky segment{risky === 1 ? "" : "s"}: drive slowly, check on arrival.
                </div>
              )}
            </>
          ) : (
            <div className="noroute" role="alert">
              <span className="noroute__icon" aria-hidden="true">
                <VehicleIcon id="boat" size={26} />
              </span>
              <div>
                <b lang="vi">Không còn đường bộ an toàn tới đây — cần thuyền</b>
                <span>
                  No safe road route{vehicle ? ` for ${vehicle.name_vi}` : ""} — send a boat.
                </span>
                {naive ? (
                  <span className="noroute__naive">
                    <span className="legend-line legend-line--blocked" aria-hidden="true" /> Shortest road, {distance(naive.length_m)},
                    runs through flooded streets.
                  </span>
                ) : (
                  <span className="noroute__naive">The destination itself is cut off by water.</span>
                )}
              </div>
            </div>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>
            <Icon name="refresh" size={14} /> New route
          </button>
        </div>
      )}
    </section>
  );
}
