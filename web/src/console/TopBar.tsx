import { useEffect, useRef, useState } from "react";
import { Icon, Logo, VehicleIcon } from "../components/Icon";
import { href, isMock, type LiveState } from "../lib/api";
import { vehicleName } from "../lib/catalog";
import { cityLabel } from "../lib/cities";
import { LangToggle, useI18n } from "../lib/i18n";
import type { Theme } from "../lib/theme";
import type { City, Vehicle } from "../lib/types";

export interface SeedState {
  running: boolean;
  received: number;
  /** From the `seed: {index, total}` field on scenario report.created events. */
  total: number | null;
  message: string | null;
}

interface Props {
  cities: City[];
  city: City;
  onCity(id: string): void;
  vehicles: Vehicle[];
  vehicle: string;
  onVehicle(id: string): void;
  live: LiveState;
  count: number;
  openCount: number;
  theme: Theme;
  onTheme(): void;
  onAbout(): void;
  askOpen: boolean;
  onAsk(): void;
  seed: SeedState;
  onSeed(): void;
  onClear(): void;
}

/** Closes a popover on outside click or Escape. */
function usePopover(): [boolean, (v: boolean | ((o: boolean) => boolean)) => void, React.RefObject<HTMLDivElement>] {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return [open, setOpen, ref];
}

export function TopBar(p: Props) {
  const { t, tn, lang } = useI18n();
  const liveLabel = { live: t("top.live"), connecting: t("top.connecting"), offline: t("top.offline") }[p.live];
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Logo />
        <span className="wordmark">Floodline</span>
      </div>

      <CityMenu cities={p.cities} city={p.city} onCity={p.onCity} />

      <div className={`live live--${p.live}`} role="status" aria-live="polite">
        <span className="live__dot" aria-hidden="true" />
        <span className="live__label">{liveLabel}</span>
        <span className="live__count">
          <b className="num">{p.count}</b> {tn("top.reports", p.count).replace(/^\s*\d+\s*/, "")}
          {p.openCount !== p.count && <span className="muted"> · {t("top.open", { n: p.openCount })}</span>}
        </span>
        {isMock && (
          <span className="mocktag" title={t("top.mock")}>
            MOCK
          </span>
        )}
      </div>

      <nav className="vchips" aria-label={t("top.vehicles")}>
        {p.vehicles.map((v) => {
          const name = vehicleName(v, lang);
          return (
            <button
              key={v.id}
              type="button"
              className={`vchip ${p.vehicle === v.id ? "is-on" : ""}`}
              aria-pressed={p.vehicle === v.id}
              onClick={() => p.onVehicle(v.id)}
              title={
                t("top.vehicleTitle", { name, limit: v.max_depth_m.toFixed(2) }) +
                (v.max_depth_flowing_m ? t("top.vehicleFlow", { limit: v.max_depth_flowing_m.toFixed(2) }) : "")
              }
            >
              <VehicleIcon id={v.id} size={17} />
              <span className="vchip__name">{name}</span>
              <span className="vchip__lim num">{v.max_depth_m.toFixed(2)} m</span>
            </button>
          );
        })}
      </nav>

      <div className="topbar__actions">
        <button
          type="button"
          className={`askbtn ${p.askOpen ? "is-on" : ""}`}
          onClick={p.onAsk}
          aria-pressed={p.askOpen}
          title={t("top.askTitle")}
        >
          <Icon name="spark" size={16} />
          <span>{t("top.ask")}</span>
        </button>
        <DemoMenu seed={p.seed} city={p.city} onSeed={p.onSeed} onClear={p.onClear} />
        <LangToggle langs={["en", "vi", "es"]} className="langtoggle--dark" />
        <button type="button" className="iconbtn" onClick={p.onAbout} title={t("top.about")} aria-label={t("top.about")}>
          <Icon name="info" />
        </button>
        <button
          type="button"
          className="iconbtn"
          onClick={p.onTheme}
          title={p.theme === "dark" ? t("top.light") : t("top.dark")}
          aria-label={p.theme === "dark" ? t("top.light") : t("top.dark")}
        >
          <Icon name={p.theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </header>
  );
}

function CityMenu({ cities, city, onCity }: { cities: City[]; city: City; onCity(id: string): void }) {
  const { t, tn } = useI18n();
  const [open, setOpen, ref] = usePopover();
  const several = cities.length > 1;
  return (
    <div className="citymenu" ref={ref}>
      <button
        type="button"
        className="citymenu__btn"
        aria-haspopup={several ? "listbox" : undefined}
        aria-expanded={several ? open : undefined}
        aria-label={`${t("top.city")}: ${cityLabel(city)}`}
        onClick={() => several && setOpen((o) => !o)}
      >
        <Icon name="pin" size={15} />
        <span className="citymenu__name">{city.name}</span>
        <span className="citymenu__country">{city.country}</span>
        {several && <Icon name="chevron" size={13} className="citymenu__chev" />}
      </button>
      {open && (
        <ul className="citymenu__list" role="listbox" aria-label={t("top.city")}>
          {cities.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === city.id}
                className={c.id === city.id ? "is-on" : ""}
                onClick={() => {
                  onCity(c.id);
                  setOpen(false);
                }}
              >
                <b>{c.name}</b>
                <span>{c.country}</span>
                {c.reports != null && <small className="num">{tn("top.cityReports", c.reports)}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DemoMenu({ seed, city, onSeed, onClear }: { seed: SeedState; city: City; onSeed(): void; onClear(): void }) {
  const { t } = useI18n();
  const [open, setOpen, ref] = usePopover();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!open) setConfirm(false);
  }, [open]);
  const canSeed = city.has_scenario !== false;

  return (
    <div className="demo" ref={ref}>
      <button
        type="button"
        className={`demo__btn ${seed.running ? "is-running" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("demo.button")}
        title={t("demo.button")}
        onClick={() => setOpen((o) => !o)}
        style={
          seed.running && seed.total
            ? ({ "--p": `${Math.round((seed.received / seed.total) * 100)}%` } as React.CSSProperties)
            : undefined
        }
      >
        {seed.running ? <span className="spinner spinner--sm" aria-hidden="true" /> : <Icon name="flask" size={15} />}
        <span className="num">
          {seed.running
            ? seed.total
              ? t("demo.receivedOf", { n: seed.received, total: seed.total })
              : t("demo.received", { n: seed.received })
            : t("demo.button")}
        </span>
      </button>
      {open && (
        <div className="demo__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            disabled={seed.running || !canSeed}
            onClick={() => {
              onSeed();
              setOpen(false);
            }}
          >
            <Icon name="play" size={15} />
            <span>
              <b>{t("demo.replay", { city: city.name })}</b>
              <small>{canSeed ? t("demo.replaySub") : t("demo.noScenario", { city: city.name })}</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={confirm ? "is-danger" : ""}
            disabled={seed.running}
            onClick={() => {
              if (!confirm) return setConfirm(true);
              onClear();
              setOpen(false);
            }}
          >
            <Icon name="trash" size={15} />
            <span>
              <b>{confirm ? t("demo.clearConfirm") : t("demo.clear")}</b>
              <small>{t("demo.clearSub", { city: city.name })}</small>
            </span>
          </button>
          <a role="menuitem" href={href("/report")} target="_blank" rel="noreferrer">
            <Icon name="camera" size={15} />
            <span>
              <b>{t("demo.resident")}</b>
              <small>{t("demo.residentSub")}</small>
            </span>
          </a>
          {seed.message && <div className="demo__msg">{seed.message}</div>}
        </div>
      )}
    </div>
  );
}
