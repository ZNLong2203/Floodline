import { useI18n } from "../lib/i18n";
import { StatusGlyph } from "./Status";

/** Street colours for one vehicle, as on the coordinators' map. */
export function MapLegend({ vehicleName, limit, compact = false }: { vehicleName: string; limit?: number; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`legend ${compact ? "legend--compact" : ""}`} aria-label={t("legend.aria")}>
      <div className="legend__title">
        <span>{vehicleName}</span>
        {limit != null && <span className="muted num"> · {t("legend.limit", { m: limit.toFixed(2) })}</span>}
      </div>
      <ul>
        <li>
          <span className="legend__line legend__line--ok" />
          <StatusGlyph status="passable" size={13} /> {t("status.passable")}
        </li>
        <li>
          <span className="legend__line legend__line--warn" />
          <StatusGlyph status="risky" size={13} /> {t("status.risky")}
        </li>
        <li>
          <span className="legend__line legend__line--bad" />
          <StatusGlyph status="impassable" size={13} /> {t("status.impassable")}
        </li>
        <li>
          <span className="legend__dot" />
          {t("legend.report")}
        </li>
      </ul>
    </div>
  );
}
