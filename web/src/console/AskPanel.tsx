import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { PriorityBadge } from "../components/Status";
import { api, ApiError } from "../lib/api";
import { distance, summaryOf } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { AskResponse, AskStep, City, Report, RouteResponse } from "../lib/types";

interface Turn {
  id: number;
  question: string;
  started: number;
  state: "pending" | "done" | "error";
  res?: AskResponse;
  error?: string;
  noKey?: boolean;
}

interface Props {
  city: City;
  reports: Report[];
  hidden?: boolean;
  onRoute(route: RouteResponse | null): void;
  onHighlight(ids: string[]): void;
  onOpenReport(id: string): void;
  onClose(): void;
}

// The API does not stream, so the thinking state shows the usual tool sequence as an animation.
const TOOL_SEQUENCE = ["list_reports", "find_place", "street_status", "plan_route", "report_detail"];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function depthRange(v: unknown): string | null {
  return Array.isArray(v) && v.length === 2 ? `${Number(v[0]).toFixed(2)}–${Number(v[1]).toFixed(2)} m` : null;
}

/** One line per tool result, for the "How I got this" list. */
function compactResult(step: AskStep): string {
  const r = (step.result ?? {}) as Record<string, unknown>;
  if (typeof r !== "object") return String(r);
  if (r.error) return `error: ${String(r.error)}`;
  switch (step.tool) {
    case "list_reports": {
      const list = Array.isArray(r.reports) ? (r.reports as Record<string, unknown>[]) : [];
      const top = list[0];
      return [
        `${num(r.count) ?? list.length} reports`,
        top ? `top P${top.priority} ${top.street ? `· ${top.street}` : ""}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "find_place": {
      const m = Array.isArray(r.matches) ? (r.matches as Record<string, unknown>[]) : [];
      return m.length ? m.slice(0, 3).map((x) => `${x.name} (${x.kind})`).join(", ") : "no match";
    }
    case "street_status": {
      const seg = num(r.segments_with_reports);
      const d = depthRange(r.depth_m_range);
      return [seg != null ? `${seg} segments` : null, d].filter(Boolean).join(" · ") || "no data";
    }
    case "plan_route": {
      const shortest = num(r.shortest_route_m);
      const safe = num(r.safe_route_m);
      const blocked = num(r.impassable_segments_on_shortest);
      if (r.no_safe_road)
        return `no safe road for ${r.vehicle ?? "vehicle"}${shortest ? ` · shortest ${distance(shortest)}` : ""}${blocked ? `, ${blocked} impassable` : ""}`;
      return `safe ${safe ? distance(safe) : "?"}${shortest ? ` vs ${distance(shortest)}` : ""}${blocked ? ` · avoids ${blocked}` : ""}`;
    }
    case "report_detail": {
      const d = depthRange(r.depth_m);
      return [`P${r.priority ?? "?"}`, r.people != null ? `${r.people} people` : null, d, r.street || null]
        .filter(Boolean)
        .join(" · ");
    }
    default: {
      const s = JSON.stringify(r);
      return s.length > 140 ? `${s.slice(0, 140)}…` : s;
    }
  }
}

function compactArgs(args: Record<string, unknown>): string {
  return Object.entries(args ?? {})
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : typeof v === "number" ? (Math.round(v * 1e4) / 1e4).toString() : JSON.stringify(v)}`)
    .join("  ");
}

function Thinking({ started }: { started: number }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const s = (now - started) / 1000;
  const step = Math.floor(s / 3.2);
  const shown = TOOL_SEQUENCE.slice(0, Math.min(TOOL_SEQUENCE.length, step + 1));
  return (
    <div className="ask__thinking" role="status" aria-live="polite">
      <div className="ask__thinkhead">
        <span className="ask__orb" aria-hidden="true">
          <Icon name="spark" size={15} />
        </span>
        <b>{t("ask.thinking")}</b>
        <span className="num muted">{Math.floor(s)} s</span>
      </div>
      <div className="ask__toolseq" aria-hidden="true">
        {shown.map((name, i) => (
          <span key={name} className={i === shown.length - 1 && step < TOOL_SEQUENCE.length ? "is-now" : ""}>
            {i > 0 && <span className="ask__arrow">→</span>}
            <code>{name}</code>
          </span>
        ))}
        <span className="ask__ellipsis">…</span>
      </div>
      <p className="muted">{t("ask.thinkingSub")}</p>
    </div>
  );
}

function Steps({ steps }: { steps: AskStep[] }) {
  const { tn, t } = useI18n();
  const [openStep, setOpenStep] = useState<number | null>(null);
  if (!steps.length) return null;
  return (
    <details className="ask__how">
      <summary>
        <Icon name="layers" size={14} /> {tn("ask.how", steps.length)}
      </summary>
      <ol className="ask__steps">
        {steps.map((s, i) => (
          <li key={i}>
            <button type="button" className="ask__step" onClick={() => setOpenStep(openStep === i ? null : i)} aria-expanded={openStep === i}>
              <span className="ask__stepn num">{i + 1}</span>
              <span className="ask__stepbody">
                <code className="ask__tool">{s.tool}</code>
                {compactArgs(s.args) && <span className="ask__args">{compactArgs(s.args)}</span>}
                <span className="ask__res">→ {compactResult(s)}</span>
              </span>
            </button>
            {openStep === i && (
              <div className="ask__json">
                <div className="eyebrow">{t("ask.args")}</div>
                <pre>{JSON.stringify(s.args, null, 1)}</pre>
                <div className="eyebrow">{t("ask.result")}</div>
                <pre>{JSON.stringify(s.result, null, 1)}</pre>
              </div>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function AskPanel({ city, reports, hidden, onRoute, onHighlight, onOpenReport, onClose }: Props) {
  const { t, lang } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [examples, setExamples] = useState<string[]>([]);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const pending = turns.some((x) => x.state === "pending");

  useEffect(() => {
    setTurns([]);
    api
      .askExamples(city.id)
      .then((e) => setExamples(Array.isArray(e) ? e : []))
      .catch(() => setExamples([]));
    return () => abort.current?.abort();
  }, [city.id]);

  // While thinking, follow the bottom; once answered, show the answer from its start.
  const turnEls = useRef(new Map<number, HTMLDivElement>());
  useEffect(() => {
    const sc = scroller.current;
    const last = turns[turns.length - 1];
    if (!sc || !last) return;
    const el = turnEls.current.get(last.id);
    if (last.state === "pending" || !el) sc.scrollTo({ top: sc.scrollHeight, behavior: "smooth" });
    else sc.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: "smooth" });
  }, [turns]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    const id = nextId.current++;
    setText("");
    setTurns((ts) => [...ts, { id, question, started: performance.now(), state: "pending" }]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await api.ask(question, city.id, ctrl.signal);
      setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, state: "done", res } : x)));
      onRoute(res.route ?? null);
      onHighlight(res.reports ?? []);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const noKey = e instanceof ApiError && e.status === 503;
      const msg = e instanceof ApiError && e.network ? t("ask.unreachable") : noKey ? (e as Error).message : t("ask.error", { msg: (e as Error).message });
      setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, state: "error", error: msg, noKey } : x)));
    }
  };

  const byId = new Map(reports.map((r) => [r.id, r]));

  return (
    <section className="ask" aria-label={t("ask.title")} hidden={hidden}>
      <header className="ask__head">
        <span className="ask__orb ask__orb--lg" aria-hidden="true">
          <Icon name="spark" size={17} />
        </span>
        <div className="ask__headtext">
          <h2>{t("ask.title")}</h2>
          <p>{t("ask.sub")}</p>
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            className="iconbtn"
            title={t("ask.clear")}
            aria-label={t("ask.clear")}
            onClick={() => {
              abort.current?.abort();
              setTurns([]);
              onRoute(null);
              onHighlight([]);
            }}
          >
            <Icon name="refresh" size={16} />
          </button>
        )}
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t("ask.close")} title={t("ask.close")}>
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="ask__scroll" ref={scroller}>
        {!turns.length && <p className="ask__intro">{t("ask.intro")}</p>}

        {turns.map((turn) => (
          <div
            key={turn.id}
            className="ask__turn"
            ref={(el) => {
              if (el) turnEls.current.set(turn.id, el);
              else turnEls.current.delete(turn.id);
            }}
          >
            <div className="ask__q">
              <span className="ask__who">{t("ask.you")}</span>
              <p>{turn.question}</p>
            </div>
            {turn.state === "pending" && <Thinking started={turn.started} />}
            {turn.state === "error" && (
              <div className={`ask__err ${turn.noKey ? "ask__err--soft" : ""}`} role="alert">
                <Icon name="alert" size={16} />
                <div>
                  <div>{turn.error}</div>
                  {turn.noKey && <div className="muted">{t("ask.noKey")}</div>}
                </div>
              </div>
            )}
            {turn.state === "done" && turn.res && (
              <div className="ask__a">
                <div className="ask__ahead">
                  <span className="ask__orb" aria-hidden="true">
                    <Icon name="spark" size={13} />
                  </span>
                  <b>Muse Spark</b>
                  {turn.res.recorded && <span className="ask__rec">{t("ask.recorded")}</span>}
                </div>
                <Markdown text={turn.res.answer} />
                {turn.res.route && (
                  <button type="button" className={`ask__route ${turn.res.route.route ? "" : "is-blocked"}`} onClick={() => onRoute(turn.res!.route)}>
                    <Icon name={turn.res.route.route ? "route" : "alert"} size={15} />
                    {turn.res.route.route
                      ? `${t("ask.routeOn")} · ${distance(turn.res.route.route.length_m)}`
                      : t("ask.routeBlocked")}
                  </button>
                )}
                {!!turn.res.reports?.length && (
                  <div className="ask__reports">
                    <div className="eyebrow">{t("ask.reports")}</div>
                    <div className="ask__chips">
                      {turn.res.reports.slice(0, 8).map((rid) => {
                        const r = byId.get(rid);
                        return (
                          <button key={rid} type="button" className="ask__chip" onClick={() => r && onOpenReport(rid)} disabled={!r} title={r ? summaryOf(r, lang) : rid}>
                            <PriorityBadge priority={r?.triage?.priority} size="sm" />
                            <span>{r ? summaryOf(r, lang) : rid}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <Steps steps={turn.res.steps ?? []} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ask__foot">
        {examples.length > 0 && (!turns.length || turns[turns.length - 1].noKey) && (
          <div className="ask__examples">
            <div className="eyebrow">{t("ask.examples")}</div>
            {examples.map((q) => (
              <button key={q} type="button" className="ask__example" disabled={pending} onClick={() => ask(q)}>
                <Icon name="spark" size={13} />
                <span>{q}</span>
              </button>
            ))}
          </div>
        )}
        <form
          className="ask__form"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text);
          }}
        >
          <textarea
            value={text}
            rows={2}
            placeholder={t("ask.placeholder")}
            aria-label={t("ask.placeholder")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(text);
              }
            }}
          />
          <button type="submit" className="btn btn--primary" disabled={pending || !text.trim()} aria-label={t("ask.send")}>
            {pending ? <span className="spinner spinner--sm" /> : <Icon name="send" size={16} />}
          </button>
        </form>
      </div>
    </section>
  );
}
