import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { PriorityBadge, ReportStatusTag, StatusGlyph } from "../components/Status";
import { vehicleName } from "../lib/catalog";
import { ageT, isClip, isWhatsApp, queueOrder, range, reportLang, STATUS, summaryOf, verdictFor } from "../lib/format";
import { type Key, useI18n } from "../lib/i18n";
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
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("open");
  const open = useMemo(() => reports.filter((r) => r.status !== "closed"), [reports]);
  const shown = useMemo(() => (filter === "open" ? open : reports).slice().sort(queueOrder), [filter, open, reports]);
  const critical = open.filter((r) => (r.triage?.priority ?? 0) >= 60).length;

  return (
    <section className="queue" aria-label={t("queue.aria")}>
      <header className="queue__head">
        <div>
          <h2 className="queue__title">{t("queue.title")}</h2>
          <div className="queue__sub">
            {t("queue.open", { n: open.length })}
            {critical > 0 && (
              <>
                {" · "}
                <span className="queue__crit">{t("queue.critical", { n: critical })}</span>
              </>
            )}
            {" · "}
            {t("queue.sorted")}
          </div>
        </div>
        <div className="seg" role="tablist" aria-label={t("queue.filter")}>
          <button type="button" role="tab" aria-selected={filter === "open"} className={filter === "open" ? "is-on" : ""} onClick={() => setFilter("open")}>
            {t("queue.filterOpen")} <span className="seg__n">{open.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>
            {t("queue.filterAll")} <span className="seg__n">{reports.length}</span>
          </button>
        </div>
      </header>

      <div className="queue__list">
        {error && (
          <div className="notice notice--bad" role="alert">
            <Icon name="wifiOff" />
            <div>
              <b>{error}</b>
              <div>{t("queue.unreachableSub")}</div>
            </div>
            <button type="button" className="btn btn--sm" onClick={onRetry}>
              {t("common.retry")}
            </button>
          </div>
        )}
        {loading && !reports.length && [0, 1, 2, 3].map((i) => <div key={i} className="card card--skeleton" aria-hidden="true" />)}
        {!loading && !error && !shown.length && (
          <div className="empty">
            <Icon name="wave" size={28} />
            <b>{filter === "open" ? t("queue.emptyOpen") : t("queue.empty")}</b>
            <span>{t("queue.emptySub")}</span>
            {emptyHint}
          </div>
        )}
        {shown.map((r) => (
          <ReportCard key={r.id} report={r} vehicle={vehicle} selected={r.id === selectedId} fresh={fresh.has(r.id)} now={now} onSelect={onSelect} />
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
  const { t, lang } = useI18n();
  const est = r.analysis?.estimate;
  const status = (vehicle ? verdictFor(r, vehicle.id) : null) ?? "unknown";
  const rl = reportLang(r);
  const summary = summaryOf(r, lang);
  return (
    <button
      type="button"
      className={`card ${selected ? "is-selected" : ""} ${fresh ? "is-fresh" : ""} ${r.status === "closed" ? "is-closed" : ""}`}
      onClick={() => onSelect(r.id)}
      aria-pressed={selected}
    >
      <div className="card__thumb">
        <img src={r.image_url} alt="" loading="lazy" />
        {fresh && <span className="card__new">{t("card.new")}</span>}
        {isClip(r) && (
          <span className="card__clip" title={`${t("card.clipTitle")}${r.analysis?.frames ? ` · ${r.analysis.frames}` : ""}`}>
            ▶ {t("card.clip")}
          </span>
        )}
      </div>
      <div className="card__body">
        <div className="card__top">
          <PriorityBadge priority={r.triage?.priority} size="sm" />
          <span className="card__age">{ageT(r.at, now, t)}</span>
        </div>
        <p className="card__summary" lang={lang === rl ? rl : "en"}>
          {summary}
        </p>
        <div className="card__bottom">
          <span className="card__depth num">{est ? range(est.low_m, est.high_m) : t("card.noDepth")}</span>
          {vehicle && (
            <span className={`verdict-mini tone--${STATUS[status].tone}`} title={`${vehicleName(vehicle, lang)}: ${t(`status.${status}` as Key)}`}>
              <StatusGlyph status={status} size={13} />
              <span className="verdict-mini__text">{t(`status.${status}` as Key)}</span>
            </span>
          )}
          {r.transcript && (
            <span className="card__src" title={t("card.voice")}>
              <Icon name="mic" size={13} />
            </span>
          )}
        </div>
        {(isWhatsApp(r) || r.location_pending || r.status !== "new") && (
          <div className="card__meta">
            {isWhatsApp(r) && <SourceLabel />}
            {r.location_pending && <PendingChip />}
            {r.status !== "new" && <ReportStatusTag status={r.status} />}
          </div>
        )}
      </div>
    </button>
  );
}

/** A neutral label for reports that came in as WhatsApp messages. */
export function SourceLabel() {
  const { t } = useI18n();
  return (
    <span className="srclabel">
      <Icon name="chat" size={12} />
      {t("src.whatsapp")}
    </span>
  );
}

/** Shown until a WhatsApp sender shares a location. */
export function PendingChip() {
  const { t } = useI18n();
  return (
    <span className="pendchip" title={t("loc.pendingTitle")}>
      <Icon name="pin" size={12} />
      {t("loc.pending")}
    </span>
  );
}
