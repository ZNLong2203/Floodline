import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon, Logo, VehicleIcon } from "../components/Icon";
import { href, isMock, type LiveState } from "../lib/api";
import { vehicleName } from "../lib/catalog";
import { cityLabel } from "../lib/cities";
import { type Lang, LANG_NAME, LANGS, useI18n } from "../lib/i18n";
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

/** A button with a popover that closes on outside click or Escape. */
function Popover({
  label,
  button,
  className = "",
  align = "left",
  children,
}: {
  label: string;
  button: ReactNode;
  className?: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={`pop ${className}`} ref={ref}>
      <button
        type="button"
        className={`tbtn ${open ? "is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open && (
        <div className={`pop__menu pop__menu--${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function TopBar(p: Props) {
  const { t, tn, lang } = useI18n();
  const current = p.vehicles.find((v) => v.id === p.vehicle);
  const liveLabel = { live: t("top.live"), connecting: t("top.connecting"), offline: t("top.offline") }[p.live];

  return (
    <header className="topbar">
      <div className="topbar__left">
        <a className="topbar__brand" href={href("/")} aria-label="Floodline">
          <Logo size={26} />
          <span className="wordmark">Floodline</span>
        </a>

        {p.cities.length > 1 ? (
          <Popover
            label={`${t("top.city")}: ${cityLabel(p.city)}`}
            className="citypop"
            button={
              <>
                <Icon name="pin" size={15} />
                <span className="tbtn__strong">{p.city.name}</span>
                <span className="tbtn__muted citypop__country">{p.city.country}</span>
                <Icon name="down" size={14} />
              </>
            }
          >
            {(close) =>
              p.cities.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={c.id === p.city.id}
                  className={`pop__item ${c.id === p.city.id ? "is-on" : ""}`}
                  onClick={() => {
                    p.onCity(c.id);
                    close();
                  }}
                >
                  <span className="pop__main">
                    <b>{c.name}</b>
                    <small>{c.country}</small>
                  </span>
                  {c.reports != null && <span className="pop__meta num">{tn("top.cityReports", c.reports)}</span>}
                </button>
              ))
            }
          </Popover>
        ) : (
          <span className="tbtn tbtn--static">
            <Icon name="pin" size={15} />
            <span className="tbtn__strong">{p.city.name}</span>
          </span>
        )}

        <span className={`live live--${p.live}`} role="status" aria-live="polite" title={liveLabel}>
          <span className="live__dot" aria-hidden="true" />
          <span className="num">{p.count}</span>
          <span className="live__word">{tn("top.reports", p.count).replace(/^\s*\d+\s*/, "")}</span>
          {isMock && (
            <span className="mocktag" title={t("top.mock")}>
              MOCK
            </span>
          )}
        </span>
      </div>

      <div className="topbar__center">
        {/* Wide screens: a segmented control. Narrower: one dropdown. CSS picks which shows. */}
        <nav className="vseg" aria-label={t("top.vehicles")}>
          {p.vehicles.map((v) => (
            <button
              key={v.id}
              type="button"
              className={p.vehicle === v.id ? "is-on" : ""}
              aria-pressed={p.vehicle === v.id}
              onClick={() => p.onVehicle(v.id)}
              title={
                t("top.vehicleTitle", { name: vehicleName(v, lang), limit: v.max_depth_m.toFixed(2) }) +
                (v.max_depth_flowing_m ? t("top.vehicleFlow", { limit: v.max_depth_flowing_m.toFixed(2) }) : "")
              }
            >
              <VehicleIcon id={v.id} size={16} />
              <span>{vehicleName(v, lang)}</span>
            </button>
          ))}
        </nav>
        <Popover
          label={`${t("top.vehicle")}: ${vehicleName(current, lang)}`}
          className="vpop"
          button={
            <>
              <span className="tbtn__muted vpop__label">{t("top.vehicle")}:</span>
              {current && <VehicleIcon id={current.id} size={16} />}
              <span className="tbtn__strong">{vehicleName(current, lang)}</span>
              <Icon name="down" size={14} />
            </>
          }
        >
          {(close) =>
            p.vehicles.map((v) => (
              <button
                key={v.id}
                type="button"
                role="menuitemradio"
                aria-checked={p.vehicle === v.id}
                className={`pop__item ${p.vehicle === v.id ? "is-on" : ""}`}
                onClick={() => {
                  p.onVehicle(v.id);
                  close();
                }}
              >
                <VehicleIcon id={v.id} size={17} />
                <span className="pop__main">
                  <b>{vehicleName(v, lang)}</b>
                </span>
                <span className="pop__meta num">≤ {v.max_depth_m.toFixed(2)} m</span>
              </button>
            ))
          }
        </Popover>
      </div>

      <div className="topbar__right">
        {p.seed.running && (
          <span className="seedchip num" role="status">
            <span className="spinner spinner--sm" aria-hidden="true" />
            {p.seed.total ? t("top.replaying", { n: p.seed.received, total: p.seed.total }) : t("demo.received", { n: p.seed.received })}
          </span>
        )}
        <button type="button" className={`tbtn ${p.askOpen ? "is-on" : ""}`} onClick={p.onAsk} aria-pressed={p.askOpen} title={t("ask.title")}>
          <Icon name="chat" size={16} />
          <span>{t("top.ask")}</span>
        </button>

        <Popover
          label={t("lang.label")}
          className="langpop"
          align="right"
          button={
            <>
              <span className="tbtn__strong">{lang.toUpperCase()}</span>
              <Icon name="down" size={14} />
            </>
          }
        >
          {(close) => <LangItems close={close} />}
        </Popover>

        <Popover label={t("top.more")} align="right" className="morepop" button={<Icon name="more" size={18} strokeWidth={2.6} />}>
          {(close) => <MoreMenu {...p} close={close} />}
        </Popover>
      </div>
    </header>
  );
}

function LangItems({ close }: { close(): void }) {
  const { lang, setLang } = useI18n();
  return (
    <>
      {LANGS.map((l: Lang) => (
        <button
          key={l}
          type="button"
          role="menuitemradio"
          aria-checked={l === lang}
          lang={l}
          className={`pop__item ${l === lang ? "is-on" : ""}`}
          onClick={() => {
            setLang(l);
            close();
          }}
        >
          <span className="pop__code">{l.toUpperCase()}</span>
          <span className="pop__main">
            <b>{LANG_NAME[l]}</b>
          </span>
          {l === lang && <Icon name="check" size={15} />}
        </button>
      ))}
    </>
  );
}

function MoreMenu(p: Props & { close(): void }) {
  const { t, lang, setLang } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const canSeed = p.city.has_scenario !== false;
  return (
    <>
      <div className="pop__section">{t("menu.demo")}</div>
      <button
        type="button"
        role="menuitem"
        className="pop__item"
        disabled={p.seed.running || !canSeed}
        onClick={() => {
          p.onSeed();
          p.close();
        }}
      >
        <Icon name="play" size={15} />
        <span className="pop__main">
          <b>{t("demo.replay", { city: p.city.name })}</b>
          <small>{canSeed ? t("demo.replaySub") : t("demo.noScenario", { city: p.city.name })}</small>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={`pop__item ${confirm ? "is-danger" : ""}`}
        disabled={p.seed.running}
        onClick={() => {
          if (!confirm) return setConfirm(true);
          p.onClear();
          p.close();
        }}
      >
        <Icon name="trash" size={15} />
        <span className="pop__main">
          <b>{confirm ? t("demo.clearConfirm") : t("demo.clear")}</b>
          <small>{t("demo.clearSub", { city: p.city.name })}</small>
        </span>
      </button>
      {p.seed.message && <div className="pop__note">{p.seed.message}</div>}

      <div className="pop__sep" />
      <a role="menuitem" className="pop__item" href={href(`/report?city=${encodeURIComponent(p.city.id)}`)} target="_blank" rel="noreferrer" onClick={p.close}>
        <Icon name="camera" size={15} />
        <span className="pop__main">
          <b>{t("menu.resident")}</b>
        </span>
        <Icon name="external" size={13} />
      </a>
      <button
        type="button"
        role="menuitem"
        className="pop__item"
        onClick={() => {
          p.onAbout();
          p.close();
        }}
      >
        <Icon name="info" size={15} />
        <span className="pop__main">
          <b>{t("menu.about")}</b>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="pop__item"
        onClick={() => {
          p.onTheme();
          p.close();
        }}
      >
        <Icon name={p.theme === "dark" ? "sun" : "moon"} size={15} />
        <span className="pop__main">
          <b>{p.theme === "dark" ? t("menu.light") : t("menu.dark")}</b>
        </span>
      </button>

      <div className="pop__sep" />
      <div className="pop__row">
        <Icon name="globe" size={15} />
        <span className="pop__main">
          <b>{t("lang.label")}</b>
        </span>
        <span className="pop__seg" role="group" aria-label={t("lang.label")}>
          {LANGS.map((l) => (
            <button key={l} type="button" className={l === lang ? "is-on" : ""} aria-pressed={l === lang} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </span>
      </div>
    </>
  );
}
