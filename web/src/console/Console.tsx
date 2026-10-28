import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { MapLegend } from "../components/MapLegend";
import { api, ApiError } from "../lib/api";
import { defaultVehicle, vehicleName } from "../lib/catalog";
import { cityLang, FALLBACK_CITIES, saveCity, savedCity } from "../lib/cities";
import { useI18n } from "../lib/i18n";
import { useNow, useTheme } from "../lib/theme";
import type { City, RouteResponse } from "../lib/types";
import { About } from "./About";
import { AskPanel } from "./AskPanel";
import { MapView } from "./MapView";
import { Queue } from "./Queue";
import { ReportDetail } from "./ReportDetail";
import { type LatLon, type Place, type Preset, ROUTE_CLOSED, RoutePanel, type RouteState } from "./RoutePanel";
import { type SeedState, TopBar } from "./TopBar";
import { useConsoleData } from "./useConsole";

/** Route presets for a city, named in the reader's language when it is the city's own. */
function presetsFor(city: City, lang: string): Preset[] {
  const local = lang === cityLang(city);
  return (city.presets ?? []).map((p, i) => {
    const label = (local && p.name_local) || p.name;
    const [from, to] = label.split(/\s*→\s*/);
    return {
      id: `${city.id}-${i}`,
      label,
      from: { name: from || label, at: p.from },
      to: { name: to || label, at: p.to },
    };
  });
}

export default function Console() {
  const { t, lang } = useI18n();
  const [cities, setCities] = useState<City[]>(FALLBACK_CITIES);
  const [cityId, setCityId] = useState<string>(() => savedCity() ?? FALLBACK_CITIES[0].id);
  const city = cities.find((c) => c.id === cityId) ?? cities[0];
  const data = useConsoleData(city.id);
  const [theme, toggleTheme] = useTheme();
  const now = useNow(20_000);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: number } | null>(null);
  const [route, setRoute] = useState<RouteState>(ROUTE_CLOSED);
  const [askOpen, setAskOpen] = useState(false);
  const [askRoute, setAskRoute] = useState<RouteResponse | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [about, setAbout] = useState(false);
  // Below 1024 px only one of list and map fits: a toggle picks which.
  const [view, setView] = useState<"map" | "list">("map");
  const [seed, setSeed] = useState<SeedState>({ running: false, received: 0, total: null, message: null });
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(() => {
    api
      .cities()
      .then((cs) => {
        if (Array.isArray(cs) && cs.length) setCities(cs);
      })
      .catch(() => undefined);
  }, []);

  const switchCity = (id: string) => {
    saveCity(id);
    setCityId(id);
    setSelectedId(null);
    setRoute(ROUTE_CLOSED);
    setAskRoute(null);
    setHighlight(new Set());
  };

  const vehicles = data.catalog.vehicles;
  const vehicle = vehicleId && vehicles.some((v) => v.id === vehicleId) ? vehicleId : defaultVehicle(vehicles);
  const currentVehicle = vehicles.find((v) => v.id === vehicle);
  const selected = useMemo(() => data.reports.find((r) => r.id === selectedId) ?? null, [data.reports, selectedId]);
  const openCount = data.reports.filter((r) => r.status !== "closed").length;
  const presets = useMemo(() => presetsFor(city, lang), [city, lang]);

  useEffect(() => {
    document.title = `${openCount ? `(${openCount}) ` : ""}Floodline · ${city.name}`;
  }, [openCount, city.name]);

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
      setSeed((s) => ({ ...s, running: progress.index < progress.total, received: progress.index, total: progress.total }));
    } else {
      setSeed((s) => (s.running ? { ...s, received: s.received + 1 } : s));
    }
  }, [data.eventCount, data.lastEvent]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setView("list");
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
      .route(a.at, b.at, vehicle, city.id)
      .then((res) => id === routeReq.current && setRoute((r) => ({ ...r, loading: false, result: res })))
      .catch((e: Error) => {
        if (id !== routeReq.current) return;
        const msg = e instanceof ApiError && e.network ? t("route.unreachable") : t("route.failed", { msg: e.message });
        setRoute((r) => ({ ...r, loading: false, error: msg, result: null }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, a, b, vehicle, data.segmentsVersion, city.id]);

  const pickPhase = route.open ? (!route.a ? "a" : !route.b ? "b" : null) : null;
  const onPick = useCallback(
    (p: LatLon) => {
      const place: Place = { name: t("route.pin", { lat: p[0].toFixed(4), lon: p[1].toFixed(4) }), at: p };
      setRoute((r) => (!r.a ? { ...r, a: place } : !r.b ? { ...r, b: place } : r));
    },
    [t],
  );

  const runSeed = async () => {
    setSeed({ running: true, received: 0, total: null, message: null });
    setSelectedId(null);
    try {
      const res = await api.demoSeed(city.id);
      setSeed((s) => ({ ...s, running: false, received: res.created, message: t("demo.replayed", { n: res.created }) }));
      notify(t("demo.replayed", { n: res.created }));
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 409
          ? t("demo.running")
          : e instanceof ApiError && e.network
            ? t("demo.unreachable")
            : t("demo.failed", { msg: (e as Error).message });
      setSeed((s) => ({ ...s, running: false, message: msg }));
      notify(msg, "bad");
      data.reload();
    }
  };

  const clearAll = async () => {
    try {
      await api.demoReset(city.id);
      setSelectedId(null);
      setRoute((r) => ({ ...r, result: null }));
      setSeed({ running: false, received: 0, total: null, message: null });
      notify(t("demo.cleared"));
    } catch (e) {
      notify(t("demo.clearFailed", { msg: (e as Error).message }), "bad");
    }
  };

  // The route on the map: the route tool's, else the assistant's.
  const shownRoute: RouteResponse | null = route.result ?? (route.open ? null : askRoute);
  const askEnds = askRoute && !route.result ? (askRoute.route ?? askRoute.naive)?.coordinates : null;
  const endpoints = route.open
    ? { a: route.a?.at ?? null, b: route.b?.at ?? null }
    : askEnds && askEnds.length > 1
      ? {
          a: [askEnds[0][1], askEnds[0][0]] as [number, number],
          b: [askEnds[askEnds.length - 1][1], askEnds[askEnds.length - 1][0]] as [number, number],
        }
      : { a: null, b: null };

  const side = selected ? "detail" : askOpen ? "ask" : "queue";
  // Frame the city's reports when they arrive (the key changes per city, so it fits once each).
  const fit = useMemo(() => {
    const pts = data.reports.filter((r) => !r.city || r.city === city.id).map((r) => [r.lat, r.lon] as [number, number]);
    return pts.length ? { points: pts, key: `${city.id}:${data.loading ? "loading" : "ready"}` } : null;
  }, [data.reports, data.loading, city.id]);

  return (
    <div className={`console side--${side}`} data-view={view}>
      <TopBar
        cities={cities}
        city={city}
        onCity={switchCity}
        vehicles={vehicles}
        vehicle={vehicle}
        onVehicle={setVehicleId}
        live={data.live}
        count={data.reports.length}
        openCount={openCount}
        theme={theme}
        onTheme={toggleTheme}
        onAbout={() => setAbout(true)}
        askOpen={askOpen}
        onAsk={() => {
          setAskOpen((o) => !o);
          setSelectedId(null);
          setView("list");
        }}
        seed={seed}
        onSeed={runSeed}
        onClear={clearAll}
      />
      <main className="console__main">
        <div className="console__map">
          <MapView
            theme={theme}
            city={city}
            vehicle={vehicle}
            vehicles={vehicles}
            reports={data.reports}
            segments={data.segments}
            selectedId={selectedId}
            fresh={data.fresh}
            highlight={highlight}
            fit={fit}
            focus={focus}
            onSelect={select}
            route={shownRoute ? { safe: shownRoute.route, naive: shownRoute.naive, blocked: !shownRoute.route } : null}
            endpoints={endpoints}
            picking={pickPhase}
            onPick={onPick}
          />
          <div className="mapui mapui--tl">
            <RoutePanel
              state={route}
              vehicle={currentVehicle}
              segments={data.segments}
              presets={presets}
              onOpen={() => setRoute({ ...ROUTE_CLOSED, open: true })}
              onClose={() => setRoute(ROUTE_CLOSED)}
              onReset={() => setRoute({ ...ROUTE_CLOSED, open: true })}
              onPreset={(id) => {
                const p = presets.find((x) => x.id === id);
                if (p) setRoute({ ...ROUTE_CLOSED, open: true, a: p.from, b: p.to });
              }}
            />
          </div>
          {pickPhase && (
            <div className="mapui mapui--tc pickhint" role="status">
              {pickPhase === "a" ? t("map.pickA") : t("map.pickB")}
            </div>
          )}
          {data.segmentsError && !pickPhase && (
            <div className="mapui mapui--tc maperr" role="status">
              {t("map.segErr", { msg: data.segmentsError })}
            </div>
          )}
          <div className="mapui mapui--bl">
            <MapLegend vehicleName={vehicleName(currentVehicle, lang) || vehicle} limit={currentVehicle?.max_depth_m} />
          </div>
        </div>

        <div className="console__side">
          {selected && (
            <ReportDetail
              report={selected}
              vehicle={currentVehicle}
              now={now}
              onClose={() => setSelectedId(null)}
              onStatus={data.setStatus}
              onLocate={() => setFocus({ lat: selected.lat, lon: selected.lon, key: Date.now() })}
            />
          )}
          {askOpen && (
            <AskPanel
              city={city}
              vehicles={vehicles}
              reports={data.reports}
              hidden={Boolean(selected)}
              onRoute={(r) => {
                setRoute(ROUTE_CLOSED);
                setAskRoute(r);
              }}
              onHighlight={(ids) => setHighlight(new Set(ids))}
              onOpenReport={select}
              onClose={() => {
                setAskOpen(false);
                setAskRoute(null);
                setHighlight(new Set());
              }}
            />
          )}
          {!selected && !askOpen && (
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
                city.has_scenario !== false ? (
                  <button type="button" className="btn btn--sm" onClick={runSeed} disabled={seed.running}>
                    {t("queue.replay", { city: city.name })}
                  </button>
                ) : null
              }
            />
          )}
        </div>
      </main>
      {toast && (
        <div className={`toast toast--${toast.tone}`} role="status">
          {toast.text}
        </div>
      )}
      <div className="viewtoggle seg" role="tablist" aria-label={t("view.aria")}>
        <button type="button" role="tab" aria-selected={view === "list"} className={view === "list" ? "is-on" : ""} onClick={() => setView("list")}>
          <Icon name="list" size={15} /> {t("view.list")}
        </button>
        <button type="button" role="tab" aria-selected={view === "map"} className={view === "map" ? "is-on" : ""} onClick={() => setView("map")}>
          <Icon name="map" size={15} /> {t("view.map")}
        </button>
      </div>
      {about && <About catalog={data.catalog} health={data.health} city={city} onClose={() => setAbout(false)} />}
    </div>
  );
}
