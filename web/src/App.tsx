import { useEffect, useState, useSyncExternalStore } from "react";
import ShapesPage from "./pages/ShapesPage.tsx";
import TownPage from "./pages/TownPage.tsx";

// Pages are switched on location.hash (#/town, #/shapes); no router dependency.
// The first entry is the default for an empty or unknown hash.
const pages = [
  { hash: "#/town", label: "Town", Page: TownPage },
  { hash: "#/shapes", label: "Shapes", Page: ShapesPage },
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

export default function App() {
  const hash = useSyncExternalStore(subscribeToHash, () => location.hash);
  const status = useServerStatus();
  const current = pages.find((p) => p.hash === hash) ?? pages[0];

  return (
    <>
      <header className="shell">
        <span className="badge">SIMULATED</span>
        <p className="status">Server: {status}</p>
        <nav>
          {pages.map((p) => (
            <a key={p.hash} href={p.hash} aria-current={p === current ? "page" : undefined}>
              {p.label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        <current.Page />
      </main>
    </>
  );
}
