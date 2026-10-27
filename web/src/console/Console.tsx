import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusGlyph } from "../components/Status";
import { api, ApiError } from "../lib/api";
import { defaultVehicle } from "../lib/catalog";
import { useNow, useTheme } from "../lib/theme";
import { About } from "./About";
import { MapView } from "./MapView";
import { Queue } from "./Queue";
import { ReportDetail } from "./ReportDetail";
import { type LatLon, type Place, PRESETS, ROUTE_CLOSED, RoutePanel, type RouteState } from "./RoutePanel";
import { type SeedState, TopBar } from "./TopBar";
import { useConsoleData } from "./useConsole";

export default function Console() {
  const data = useConsoleData();
  const [theme, toggleTheme] = useTheme();
  const now = useNow(20_000);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null);
  const [route, setRoute] = useState<RouteState>(ROUTE_CLOSED);
  const [about, setAbout] = useState(false);
  const [seed, setSeed] = useState<SeedState>({ running: false, received: 0, total: null, message: null });
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);

  const vehicles = data.catalog.vehicles;
  const vehicle = vehicleId && vehicles.some((v) => v.id === vehicleId) ? vehicleId : defaultVehicle(vehicles);
  const currentVehicle = vehicles.find((v) => v.id === vehicle);
  const selected = useMemo(() => data.reports.find((r) => r.id === selectedId) ?? null, [data.reports, selectedId]);
  const openCount = data.reports.filter((r) => r.status !== "closed").length;

  useEffect(() => {
    document.title = openCount ? `(${openCount}) Floodline · Huế` : "Floodline · Huế";
  }, [openCount]);

  // Deselect when a report disappears (e.g. reports.reset).
  useEffect(() => {
    if (selectedId && !data.reports.some((r) => r.id === selectedId)) setSelectedId(null);
  }, [data.reports, selectedId]);

  // Count reports arriving during a scenario replay.
  const lastCount = useRef(0);
  useEffect(() => {
    if (data.eventCount === lastCount.current) return;
    lastCount.current = data.eventCount;
    const e = data.lastEvent;
    if (e?.type !== "report.created") return;
    const progress = e.data.seed;
    if (progress) {
      // Also shows a replay started from another console.
      setSeed((s) => ({ ...s, running: progress.index < progress.total, received: progress.index, total: progress.total }));
    } else {
      setSeed((s) => (s.running ? { ...s, received: s.received + 1 } : s));
    }
  }, [data.eventCount, data.lastEvent]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      const r = data.reports.find((x) => x.id === id);
      if (r) setFocus({ lat: r.lat, lon: r.lon, key: Date.now() });
    },
    [data.reports],
  );

  // Routing: fetch whenever both ends are set, and again when the vehicle or the water changes.
  const routeReq = useRef(0);
  const { a, b, open } = route;
  useEffect(() => {
    if (!open || !a || !b) return;
    const id = ++routeReq.current;
    setRoute((r) => ({ ...r, loading: true, error: null }));
    api
      .route(a.at, b.at, vehicle)
      .then((res) => id === routeReq.current && setRoute((r) => ({ ...r, loading: false, result: res })))
      .catch((e: Error) => {
        if (id !== routeReq.current) return;
        const msg =
          e instanceof ApiError && e.network ? "Cannot reach the server to plan a route." : `Routing failed: ${e.message}`;
        setRoute((r) => ({ ...r, loading: false, error: msg, result: null }));
      });
  }, [open, a, b, vehicle, data.segmentsVersion]);

  const pickPhase = route.open ? (!route.a ? "a" : !route.b ? "b" : null) : null;
  const onPick = useCallback((p: LatLon) => {
    const place: Place = { name: `Pin ${p[0].toFixed(4)}, ${p[1].toFixed(4)}`, at: p };
    setRoute((r) => (!r.a ? { ...r, a: place } : !r.b ? { ...r, b: place } : r));
  }, []);

  const runSeed = async () => {
    setSeed({ running: true, received: 0, total: null, message: null });
    setSelectedId(null);
    try {
      const res = await api.demoSeed();
      setSeed((s) => ({ ...s, running: false, received: res.created, message: `Replayed ${res.created} reports.` }));
      notify(`Scenario replayed: ${res.created} reports.`);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 409
          ? "A replay is already running."
          : e instanceof ApiError && e.network
            ? "Cannot reach the server."
            : `Replay failed: ${(e as Error).message}`;
      setSeed((s) => ({ ...s, running: false, message: msg }));
      notify(msg, "bad");
      data.reload();
    }
  };

  const clearAll = async () => {
    try {
      await api.demoReset();
      setSelectedId(null);
      setRoute((r) => ({ ...r, result: null }));
      setSeed({ running: false, received: 0, total: null, message: null });
      notify("All reports cleared.");
    } catch (e) {
      setSeed((s) => ({ ...s, message: `Clear failed: ${(e as Error).message}` }));
      notify(`Clear failed: ${(e as Error).message}`, "bad");
    }
  };

  return (
    <div className={`console ${selected ? "has-detail" : ""}`}>
      <TopBar
        vehicles={vehicles}
        vehicle={vehicle}
        onVehicle={setVehicleId}
        live={data.live}
        count={data.reports.length}
        openCount={openCount}
        theme={theme}
        onTheme={toggleTheme}
        onAbout={() => setAbout(true)}
        seed={seed}
        onSeed={runSeed}
        onClear={clearAll}
      />
      <main className="console__main">
        <div className="console__map">
          <MapView
            theme={theme}
            vehicle={vehicle}
            vehicles={vehicles}
            reports={data.reports}
            segments={data.segments}
            selectedId={selectedId}
            fresh={data.fresh}
            focus={focus}
            onSelect={select}
            route={route.result ? { safe: route.result.route, naive: route.result.naive, blocked: !route.result.route } : null}
            endpoints={{ a: route.a?.at ?? null, b: route.b?.at ?? null }}
            picking={pickPhase}
            onPick={onPick}
          />
          <div className="mapui mapui--tl">
            <RoutePanel
              state={route}
              vehicle={currentVehicle}
              segments={data.segments}
              onOpen={() => setRoute({ ...ROUTE_CLOSED, open: true })}
              onClose={() => setRoute(ROUTE_CLOSED)}
              onReset={() => setRoute({ ...ROUTE_CLOSED, open: true })}
              onPreset={(id) => {
                const p = PRESETS.find((x) => x.id === id);
                if (p) setRoute({ ...ROUTE_CLOSED, open: true, a: p.from, b: p.to });
              }}
            />
          </div>
          {pickPhase && (
            <div className="mapui mapui--tc pickhint" role="status">
              Click the map to set the {pickPhase === "a" ? "start (A)" : "destination (B)"}
            </div>
          )}
          {data.segmentsError && !pickPhase && (
            <div className="mapui mapui--tc maperr" role="status">
              Street layer unavailable: {data.segmentsError}
            </div>
          )}
          {toast && (
            <div className={`mapui mapui--bc toast toast--${toast.tone}`} role="status">
              {toast.text}
            </div>
          )}
          <div className="mapui mapui--bl">
            <Legend vehicleName={currentVehicle?.name_vi ?? vehicle} limit={currentVehicle?.max_depth_m} />
          </div>
        </div>

        <div className="console__side">
          {selected ? (
            <ReportDetail
              report={selected}
              vehicle={currentVehicle}
              now={now}
              onClose={() => setSelectedId(null)}
              onStatus={data.setStatus}
              onLocate={() => setFocus({ lat: selected.lat, lon: selected.lon, key: Date.now() })}
            />
          ) : (
            <Queue
              reports={data.reports}
              loading={data.loading}
              error={data.error}
              vehicle={currentVehicle}
              selectedId={selectedId}
              fresh={data.fresh}
              now={now}
              onSelect={select}
              onRetry={data.reload}
              emptyHint={
                <button type="button" className="btn btn--sm" onClick={runSeed} disabled={seed.running}>
                  Replay the Huế demo scenario
                </button>
              }
            />
          )}
        </div>
      </main>
      {about && <About catalog={data.catalog} health={data.health} onClose={() => setAbout(false)} />}
    </div>
  );
}

function Legend({ vehicleName, limit }: { vehicleName: string; limit?: number }) {
  return (
    <div className="legend" aria-label="Map legend">
      <div className="legend__title">
        <span lang="vi">{vehicleName}</span>
        {limit != null && <span className="muted num"> · limit {limit.toFixed(2)} m</span>}
      </div>
      <ul>
        <li>
          <span className="legend__line legend__line--ok" />
          <StatusGlyph status="passable" size={13} /> Passable
        </li>
        <li>
          <span className="legend__line legend__line--warn" />
          <StatusGlyph status="risky" size={13} /> Risky
        </li>
        <li>
          <span className="legend__line legend__line--bad" />
          <StatusGlyph status="impassable" size={13} /> Impassable
        </li>
        <li>
          <span className="legend__dot" />
          Report · size and colour by priority
        </li>
      </ul>
    </div>
  );
}
