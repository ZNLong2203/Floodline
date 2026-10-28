import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type LiveState } from "../lib/api";
import { FALLBACK_CATALOG } from "../lib/catalog";
import type { Catalog, Health, LiveEvent, Report, ReportStatus, SegmentCollection } from "../lib/types";

const FRESH_MS = 9000;

export interface ConsoleData {
  catalog: Catalog;
  catalogLive: boolean;
  health: Health | null;
  reports: Report[];
  loading: boolean;
  error: string | null;
  segments: SegmentCollection | null;
  segmentsError: string | null;
  segmentsVersion: number;
  live: LiveState;
  fresh: Set<string>;
  setStatus(id: string, status: ReportStatus): Promise<void>;
  reload(): void;
  lastEvent: LiveEvent | null;
  eventCount: number;
}

export function useConsoleData(city: string): ConsoleData {
  const [catalog, setCatalog] = useState<Catalog>(FALLBACK_CATALOG);
  const [catalogLive, setCatalogLive] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<SegmentCollection | null>(null);
  const [segmentsError, setSegmentsError] = useState<string | null>(null);
  const [segmentsVersion, setSegmentsVersion] = useState(0);
  const [live, setLive] = useState<LiveState>("connecting");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const segTimer = useRef<number | undefined>(undefined);

  const loadSegments = useCallback(() => {
    window.clearTimeout(segTimer.current);
    segTimer.current = window.setTimeout(() => {
      api
        .segments(city)
        .then((s) => {
          setSegments(s);
          setSegmentsError(null);
          setSegmentsVersion((v) => v + 1);
        })
        .catch((e: Error) => setSegmentsError(e.message || "Street layer unavailable"));
    }, 250);
  }, [city]);

  const loadReports = useCallback(() => {
    api
      .reports(city)
      .then((r) => {
        setReports(r);
        setError(null);
      })
      .catch((e: Error) =>
        setError(e instanceof ApiError && e.network ? "Cannot reach the Floodline server." : e.message),
      )
      .finally(() => setLoading(false));
  }, [city]);

  const reload = useCallback(() => {
    loadReports();
    loadSegments();
  }, [loadReports, loadSegments]);

  useEffect(() => {
    setLoading(true);
    setReports([]);
    setSegments(null);
    api
      .catalog(city)
      .then((c) => {
        if (c?.vehicles?.length) {
          setCatalog(c);
          setCatalogLive(true);
        }
      })
      .catch(() => setCatalogLive(false));
    api.health().then(setHealth).catch(() => setHealth(null));
    reload();
  }, [reload, city]);

  // Live events
  useEffect(() => {
    const markFresh = (id: string) => {
      setFresh((s) => new Set(s).add(id));
      window.setTimeout(
        () =>
          setFresh((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          }),
        FRESH_MS,
      );
    };
    const stop = api.subscribe(
      (e) => {
        // Events for other cities are not ours.
        const evCity = e.type === "reports.reset" ? (e.data as { city?: string })?.city : e.data.city;
        if (evCity && evCity !== city) return;
        setLastEvent(e);
        setEventCount((n) => n + 1);
        if (e.type === "reports.reset") {
          setReports([]);
          setFresh(new Set());
        } else if (e.type === "report.created") {
          setReports((rs) => [e.data, ...rs.filter((r) => r.id !== e.data.id)].sort((a, b) => b.at - a.at));
          markFresh(e.data.id);
        } else {
          setReports((rs) => rs.map((r) => (r.id === e.data.id ? e.data : r)));
        }
        loadSegments();
      },
      (s) => setLive(s),
    );
    return stop;
  }, [loadSegments, city]);

  // Ages widen the fused intervals over time, so refresh the street layer now and then.
  useEffect(() => {
    const t = window.setInterval(loadSegments, 60_000);
    return () => window.clearInterval(t);
  }, [loadSegments]);

  // If the event stream is down, fall back to polling.
  useEffect(() => {
    if (live === "live") return;
    const t = window.setInterval(loadReports, 15_000);
    return () => window.clearInterval(t);
  }, [live, loadReports]);

  const setStatus = useCallback(async (id: string, status: ReportStatus) => {
    setReports((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      const updated = await api.setStatus(id, status);
      setReports((rs) => rs.map((r) => (r.id === id ? updated : r)));
    } catch (e) {
      loadReports();
      throw e;
    }
  }, [loadReports]);

  return {
    catalog,
    catalogLive,
    health,
    reports,
    loading,
    error,
    segments,
    segmentsError,
    segmentsVersion,
    live,
    fresh,
    setStatus,
    reload,
    lastEvent,
    eventCount,
  };
}
