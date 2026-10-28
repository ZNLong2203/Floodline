import { useEffect } from "react";
import { Icon, Logo } from "./components/Icon";
import { href } from "./lib/api";
import { LangToggle, useI18n } from "./lib/i18n";

/** Any path other than /, /report and /attribution. */
export default function NotFound() {
  const { t } = useI18n();
  useEffect(() => {
    document.title = `${t("nf.title")} · Floodline`;
  }, [t]);
  const links = [
    { to: "/", icon: "map" as const, title: t("nf.console"), sub: t("nf.consoleSub") },
    { to: "/report", icon: "camera" as const, title: t("nf.report"), sub: t("nf.reportSub") },
    { to: "/attribution", icon: "image" as const, title: t("nf.credits"), sub: t("nf.creditsSub") },
  ];
  return (
    <div className="nf">
      <header className="rp__bar">
        <a href={href("/")} className="rp__brand">
          <Logo size={26} />
          <span className="wordmark">Floodline</span>
        </a>
        <LangToggle />
      </header>
      <main className="nf__main">
        <p className="nf__code num">404</p>
        <h1>{t("nf.title")}</h1>
        <p className="nf__body">{t("nf.body")}</p>
        <ul className="nf__links">
          {links.map((l) => (
            <li key={l.to}>
              <a href={href(l.to)}>
                <Icon name={l.icon} size={18} />
                <span>
                  <b>{l.title}</b>
                  <small>{l.sub}</small>
                </span>
                <Icon name="chevron" size={16} />
              </a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
