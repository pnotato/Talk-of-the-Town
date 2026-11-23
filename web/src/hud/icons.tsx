// The HUD's icons: one 20-unit grid, one stroke weight, round ends, drawn in currentColor.
import type { ReactNode } from "react";

function Icon({ children, filled = false }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      className="hud-icon"
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A smiling shape: the smallest possible expression of the game's cast. */
export function BrandMark() {
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

export function PlayIcon() {
  return (
    <Icon filled>
      <path d="M6.6 4.7v10.6a.9.9 0 0 0 1.37.77l8.4-5.3a.9.9 0 0 0 0-1.54l-8.4-5.3a.9.9 0 0 0-1.37.77Z" />
    </Icon>
  );
}

export function PauseIcon() {
  return (
    <Icon filled>
      <rect x="5.4" y="4.4" width="3.2" height="11.2" rx="1.1" />
      <rect x="11.4" y="4.4" width="3.2" height="11.2" rx="1.1" />
    </Icon>
  );
}

export function ReplayIcon() {
  return (
    <Icon>
      <path d="M4.6 10a5.6 5.6 0 1 0 1.8-4.1" />
      <path d="M4.4 3.6v3.2h3.2" />
    </Icon>
  );
}

export function FeedIcon() {
  return (
    <Icon>
      <path d="M4 4.6h9.4v10.1a1.8 1.8 0 0 0 1.8 1.8H5.8A1.8 1.8 0 0 1 4 14.7Z" />
      <path d="M13.4 8.2H16v6.5a1.8 1.8 0 0 1-1.8 1.8" />
      <path d="M6.6 7.6h4.2M6.6 10.3h4.2M6.6 13h2.4" />
    </Icon>
  );
}

export function PeopleIcon() {
  return (
    <Icon>
      <circle cx="7.6" cy="7.1" r="2.6" />
      <path d="M2.9 15.8c.6-2.6 2.4-4 4.7-4s4.1 1.4 4.7 4" />
      <path d="M12.7 4.7a2.5 2.5 0 0 1 0 4.8M14.4 11.9c1.4.5 2.4 1.8 2.8 3.9" />
    </Icon>
  );
}

export function SlidersIcon() {
  return (
    <Icon>
      <path d="M3.5 6.2h6.4M14 6.2h2.5M3.5 13.8h2.5M10.1 13.8h6.4" />
      <circle cx="12" cy="6.2" r="2.1" />
      <circle cx="8.1" cy="13.8" r="2.1" />
    </Icon>
  );
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="m5.6 5.6 8.8 8.8M14.4 5.6l-8.8 8.8" />
    </Icon>
  );
}

export function ChevronIcon({ direction }: { direction: "previous" | "next" }) {
  return (
    <Icon>
      <path d={direction === "previous" ? "M12 4.8 6.8 10l5.2 5.2" : "m8 4.8 5.2 5.2L8 15.2"} />
    </Icon>
  );
}

export function SearchIcon() {
  return (
    <Icon>
      <circle cx="8.8" cy="8.8" r="4.9" />
      <path d="m12.6 12.6 3.6 3.6" />
    </Icon>
  );
}

export function ShuffleIcon() {
  return (
    <Icon>
      <path d="M15.4 8.4A5.7 5.7 0 0 0 5 6.5M4.6 11.6A5.7 5.7 0 0 0 15 13.5" />
      <path d="M4.8 3.6v3h3M15.2 16.4v-3h-3" />
    </Icon>
  );
}

export function ArrowIcon({ direction }: { direction: "back" | "out" }) {
  return (
    <Icon>
      <path
        d={
          direction === "back"
            ? "M15.6 10H4.6M9 5.4 4.4 10 9 14.6"
            : "m6.6 13.4 6.8-6.8M7.8 6.6h5.6v5.6"
        }
      />
    </Icon>
  );
}

export function MegaphoneIcon() {
  return (
    <Icon>
      <path d="M3.8 8.4v3.2a1 1 0 0 0 1 1h1.6l6.4 3.3V4.1L6.4 7.4H4.8a1 1 0 0 0-1 1Z" />
      <path d="M15.4 7.6a3.4 3.4 0 0 1 0 4.8M6.6 12.6l.9 3.4" />
    </Icon>
  );
}

export function PackageIcon() {
  return (
    <Icon>
      <path d="M10 3.3 16.1 6.4v7.2L10 16.7l-6.1-3.1V6.4Z" />
      <path d="m3.9 6.4 6.1 3.1 6.1-3.1M10 9.5v7.2" />
    </Icon>
  );
}

export function ChatIcon() {
  return (
    <Icon>
      <path d="M4 5.6A1.6 1.6 0 0 1 5.6 4h8.8A1.6 1.6 0 0 1 16 5.6v6.2a1.6 1.6 0 0 1-1.6 1.6H9l-3.6 2.8v-2.8h0A1.4 1.4 0 0 1 4 12Z" />
    </Icon>
  );
}
