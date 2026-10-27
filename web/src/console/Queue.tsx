import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { PriorityBadge, ReportStatusTag, StatusGlyph } from "../components/Status";
import { age, isClip, queueOrder, range, STATUS, summaryOf, verdictFor } from "../lib/format";
import type { Report, Vehicle } from "../lib/types";

interface Props {
  reports: Report[];
  loading: boolean;
  error: string | null;
  vehicle: Vehicle | undefined;
  selectedId: string | null;
  fresh: Set<string>;
  now: number;
  onSelect(id: string): void;
  onRetry(): void;
  emptyHint?: React.ReactNode;
}

type Filter = "open" | "all";

export function Queue({ reports, loading, error, vehicle, selectedId, fresh, now, onSelect, onRetry, emptyHint }: Props) {
  const [filter, setFilter] = useState<Filter>("open");
  const open = reports.filter((r) => r.status !== "closed");
  const shown = useMemo(
    () => (filter === "open" ? open : reports).slice().sort(queueOrder),
    [filter, open, reports],
  );
  const critical = open.filter((r) => (r.triage?.priority ?? 0) >= 60).length;

  return (
    <section className="queue" aria-label="Triage queue">
      <header className="queue__head">
        <div>
          <h2 className="queue__title">Triage queue</h2>
          <div className="queue__sub">
            {open.length} open{critical > 0 && <> · <span className="queue__crit">{critical} critical</span></>} · sorted by priority
          </div>
        </div>
        <div className="seg" role="tablist" aria-label="Filter reports">
          <button type="button" role="tab" aria-selected={filter === "open"} className={filter === "open" ? "is-on" : ""} onClick={() => setFilter("open")}>
            Open <span className="seg__n">{open.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>
            All <span className="seg__n">{reports.length}</span>
          </button>
        </div>
      </header>

      <div className="queue__list">
        {error && (
          <div className="notice notice--bad" role="alert">
            <Icon name="wifiOff" />
            <div>
              <b>{error}</b>
              <div>Reports will appear when the connection returns.</div>
            </div>
            <button type="button" className="btn btn--sm" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
        {loading && !reports.length && (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card card--skeleton" aria-hidden="true" />
            ))}
          </>
        )}
        {!loading && !error && !shown.length && (
          <div className="empty">
            <Icon name="wave" size={28} />
            <b>No {filter === "open" ? "open " : ""}reports yet</b>
            <span>New photos from residents appear here the moment they are analysed.</span>
            {emptyHint}
          </div>
        )}
        {shown.map((r) => (
          <ReportCard
            key={r.id}
            report={r}
            vehicle={vehicle}
            selected={r.id === selectedId}
            fresh={fresh.has(r.id)}
            now={now}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function ReportCard({
  report: r,
  vehicle,
  selected,
  fresh,
  now,
  onSelect,
}: {
  report: Report;
  vehicle: Vehicle | undefined;
  selected: boolean;
  fresh: boolean;
  now: number;
  onSelect(id: string): void;
}) {
  const est = r.analysis?.estimate;
  const verdict = vehicle ? verdictFor(r, vehicle.id) : null;
  const status = verdict ?? "unknown";
  return (
    <button
      type="button"
      className={`card ${selected ? "is-selected" : ""} ${fresh ? "is-fresh" : ""} ${r.status === "closed" ? "is-closed" : ""}`}
      onClick={() => onSelect(r.id)}
      aria-pressed={selected}
    >
      <div className="card__thumb">
        <img src={r.image_url} alt="" loading="lazy" />
        {fresh && <span className="card__new">NEW</span>}
        {isClip(r) && (
          <span className="card__clip" title={`Video clip${r.analysis?.frames ? `, ${r.analysis.frames} frames` : ""}`}>
            ▶ CLIP
          </span>
        )}
      </div>
      <div className="card__body">
        <div className="card__top">
          <PriorityBadge priority={r.triage?.priority} size="sm" />
          <span className="card__depth num">{est ? range(est.low_m, est.high_m) : "depth ?"}</span>
          <span className="card__age">{age(r.at, now)}</span>
        </div>
        <p className="card__summary" lang="vi">
          {summaryOf(r)}
        </p>
        <div className="card__bottom">
          {vehicle && (
            <span className={`verdict-mini tone--${STATUS[status].tone}`}>
              <StatusGlyph status={status} size={13} />
              {vehicle.name_vi}: {STATUS[status].en}
            </span>
          )}
          <ReportStatusTag status={r.status} />
          {(r.transcript || r.source !== "web") && (
            <span className="card__src" title={r.transcript ? "Has a voice note" : `Source: ${r.source}`}>
              {r.transcript ? <Icon name="mic" size={13} /> : null}
              {r.source !== "web" ? r.source : null}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
