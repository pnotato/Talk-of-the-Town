import { useEffect, useState, useSyncExternalStore } from "react";
import ShapesPage from "./pages/ShapesPage.tsx";
import TownPage from "./pages/TownPage.tsx";

// Pages are switched on location.hash (#/town, #/shapes); no router dependency.
// The first entry is the default for an empty or unknown hash.
const pages = [
  { hash: "#/town", label: "Town", Page: TownPage, icon: TownIcon },
  { hash: "#/shapes", label: "Shapes", Page: ShapesPage, icon: ShapesIcon },
];

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function useServerStatus() {
  const [status, setStatus] = useState("…");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { status: string }) => setStatus(d.status))
      .catch(() => setStatus("offline"));
  }, []);

  return status;
}

/** A smiling shape: the smallest possible expression of the game's cast. */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
      <rect x="2.5" y="3" width="31" height="30" rx="10.5" fill="#e6753e" />
      <path
        d="M4 12.4c3.8-5.8 9.2-8.3 15.8-7.2 4.6.8 8.1 3.3 10.3 7.2-4 2-8.8 2.7-14.1 2.1-4.8-.5-8.8-1.2-12-2.1Z"
        fill="#f3945e"
        opacity="0.55"
      />
      <circle cx="13" cy="18" r="1.7" fill="#fffaf0" />
      <circle cx="23" cy="18" r="1.7" fill="#fffaf0" />
      <path
        d="M13 23c2.7 2.1 7.3 2.1 10 0"
        fill="none"
        stroke="#fffaf0"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TownIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="m2.4 7.3 5.6-4.5 5.6 4.5M3.8 6.5v5.8h8.4V6.5M6.5 12.3V9h3v3.3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShapesIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <rect x="1.5" y="8.1" width="6" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.7" cy="11.1" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 2 11.2 7.1H4.8L8 2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function serverLabel(status: string) {
  if (status === "…") return "Connecting";
  return status === "ok" ? "Online" : "Offline";
}

export default function App() {
  const hash = useSyncExternalStore(subscribeToHash, () => location.hash);
  const status = useServerStatus();
  const current = pages.find((p) => p.hash === hash) ?? pages[0];
  const connection = status === "…" ? "pending" : status === "ok" ? "online" : "offline";

  return (
    <div className="app">
      <header className="app-bar">
        <a className="brand" href="#/town" aria-label="Talk of the Town home">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-title">Talk of the Town</span>
            <span className="brand-kicker">Population playground</span>
          </span>
        </a>

        <nav className="app-nav" aria-label="Sections">
          {pages.map((p) => {
            const Icon = p.icon;
            return (
              <a
                key={p.hash}
                className="nav-tab"
                href={p.hash}
                aria-current={p === current ? "page" : undefined}
              >
                <Icon />
                {p.label}
              </a>
            );
          })}
        </nav>

        <p
          className={`server server-${connection}`}
          role="status"
          aria-label={`Simulation server ${serverLabel(status).toLowerCase()}`}
        >
          <span className="server-dot" aria-hidden="true" />
          {serverLabel(status)}
        </p>
      </header>

      <main className="app-main">
        <div className="stage">
          <current.Page />
        </div>
      </main>

      <p className="fiction-note">Simulated · Fictional people, companies and events</p>
    </div>
  );
}
