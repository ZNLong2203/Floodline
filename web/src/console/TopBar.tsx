import { useEffect, useRef, useState } from "react";
import { Icon, Logo, VehicleIcon } from "../components/Icon";
import { href, isMock, type LiveState } from "../lib/api";
import type { Theme } from "../lib/theme";
import type { Vehicle } from "../lib/types";

export interface SeedState {
  running: boolean;
  received: number;
  /** From the `seed: {index, total}` field on scenario report.created events. */
  total: number | null;
  message: string | null;
}

interface Props {
  vehicles: Vehicle[];
  vehicle: string;
  onVehicle(id: string): void;
  live: LiveState;
  count: number;
  openCount: number;
  theme: Theme;
  onTheme(): void;
  onAbout(): void;
  seed: SeedState;
  onSeed(): void;
  onClear(): void;
}

const LIVE_LABEL: Record<LiveState, string> = { live: "Live", connecting: "Connecting", offline: "Offline" };

export function TopBar(p: Props) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Logo />
        <span className="wordmark">Floodline</span>
        <span className="topbar__city" lang="vi">
          Huế
        </span>
      </div>

      <div className={`live live--${p.live}`} role="status" aria-live="polite">
        <span className="live__dot" aria-hidden="true" />
        <span className="live__label">{LIVE_LABEL[p.live]}</span>
        <span className="live__count">
          <b className="num">{p.count}</b> report{p.count === 1 ? "" : "s"}
          {p.openCount !== p.count && <span className="muted"> · {p.openCount} open</span>}
        </span>
        {isMock && <span className="mocktag" title="Demo data generated in the browser (?mock=1)">MOCK</span>}
      </div>

      <nav className="vchips" aria-label="Vehicle class">
        {p.vehicles.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`vchip ${p.vehicle === v.id ? "is-on" : ""}`}
            aria-pressed={p.vehicle === v.id}
            onClick={() => p.onVehicle(v.id)}
            title={`${v.name_en}: impassable above ${v.max_depth_m.toFixed(2)} m${v.max_depth_flowing_m ? ` (${v.max_depth_flowing_m.toFixed(2)} m in flowing water)` : ""}`}
          >
            <VehicleIcon id={v.id} size={17} />
            <span className="vchip__name" lang="vi">
              {v.name_vi}
            </span>
            <span className="vchip__lim num">{v.max_depth_m.toFixed(2)} m</span>
          </button>
        ))}
      </nav>

      <div className="topbar__actions">
        <DemoMenu seed={p.seed} onSeed={p.onSeed} onClear={p.onClear} />
        <a className="iconbtn" href={href("/report")} target="_blank" rel="noreferrer" title="Open the resident report page" aria-label="Open the resident report page">
          <Icon name="camera" />
        </a>
        <button type="button" className="iconbtn" onClick={p.onAbout} title="How it works" aria-label="How Floodline works">
          <Icon name="info" />
        </button>
        <button
          type="button"
          className="iconbtn"
          onClick={p.onTheme}
          title={p.theme === "dark" ? "Light theme" : "Dark theme"}
          aria-label={p.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          <Icon name={p.theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </header>
  );
}

function DemoMenu({ seed, onSeed, onClear }: { seed: SeedState; onSeed(): void; onClear(): void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirm(false);
      }
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="demo" ref={ref}>
      <button
        type="button"
        className={`demo__btn ${seed.running ? "is-running" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={
          seed.running && seed.total
            ? ({ "--p": `${Math.round((seed.received / seed.total) * 100)}%` } as React.CSSProperties)
            : undefined
        }
      >
        {seed.running ? <span className="spinner spinner--sm" aria-hidden="true" /> : <Icon name="flask" size={15} />}
        <span className="num">
          {seed.running ? (seed.total ? `${seed.received}/${seed.total} received` : `${seed.received} received`) : "Demo"}
        </span>
      </button>
      {open && (
        <div className="demo__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            disabled={seed.running}
            onClick={() => {
              onSeed();
              setOpen(false);
            }}
          >
            <Icon name="play" size={15} />
            <span>
              <b>Replay Huế scenario</b>
              <small>Clears the map, then photos arrive one by one</small>
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
              setConfirm(false);
              setOpen(false);
            }}
          >
            <Icon name="trash" size={15} />
            <span>
              <b>{confirm ? "Click again to clear" : "Clear"}</b>
              <small>Remove every report</small>
            </span>
          </button>
          <a role="menuitem" href={href("/report")} target="_blank" rel="noreferrer">
            <Icon name="camera" size={15} />
            <span>
              <b>Resident page</b>
              <small>Send a report from a phone</small>
            </span>
          </a>
          {seed.message && <div className="demo__msg">{seed.message}</div>}
        </div>
      )}
    </div>
  );
}
