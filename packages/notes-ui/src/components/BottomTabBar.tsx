import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { useVaultStore } from "@/lib/vault";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

// Mobile + tablet fixed bottom navigation. Primary wayfinding on phones and
// tablets; replaces the header-hamburger-as-only-nav pattern that shipped
// before the IA shift. Hidden on >= lg breakpoints where the desktop inline
// cluster in Header handles navigation. The breakpoint MUST match Header's
// desktop-cluster `lg:flex` gate — at 768-1023px, neither would be shown if
// these two diverged, and primary navigation would disappear (notes#147).
//
// Each tab is a 56px-tall touch target with an icon and a label. Icons are
// inline SVGs (no new deps) sized 20px. Active tab is determined by
// `location.pathname` with a loose-prefix match so e.g. `/n/:id` still
// highlights the Home tab.

export function BottomTabBar() {
  const hasActiveVault = useVaultStore((s) => s.activeVaultId !== null);
  const setSwitcherOpen = useQuickSwitchOpen((s) => s.setOpen);
  const location = useLocation();

  if (!hasActiveVault) return null;

  const path = location.pathname;
  const isHome =
    path === "/" || path.startsWith("/n/") || path === "/pinned" || path === "/archived";
  const isTags = path === "/tags";
  const isCapture = path === "/capture" || path === "/new";
  const isSettings = path === "/settings";

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-5xl items-stretch justify-around">
        <Tab to="/" label="Home" active={isHome} icon={<IconHome />} />
        <Tab to="/tags" label="Tags" active={isTags} icon={<IconTag />} />
        <Tab to="/capture" label="Capture" active={isCapture} icon={<IconPlus />} />
        <TabButton label="Search" icon={<IconSearch />} onClick={() => setSwitcherOpen(true)} />
        <Tab to="/settings" label="Settings" active={isSettings} icon={<IconCog />} />
      </ul>
    </nav>
  );
}

function Tab({
  to,
  label,
  icon,
  active,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <li className="flex-1">
      <Link
        to={to}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
          active ? "text-accent" : "text-fg-muted hover:text-accent"
        }`}
      >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </Link>
    </li>
  );
}

function TabButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <li className="flex-1">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted hover:text-accent"
      >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </button>
    </li>
  );
}

// Inline SVGs — lucide-react isn't a dependency and keeps the bundle tight.
// 20px square, 1.75 stroke, matches the weight of the rest of the UI.
const SVG_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconHome() {
  return (
    <svg {...SVG_PROPS} aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg {...SVG_PROPS} aria-hidden="true">
      <path d="M20.5 12.5 12.5 20.5a2 2 0 0 1-2.83 0L3 13.83V3h10.83L20.5 9.67a2 2 0 0 1 0 2.83Z" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg {...SVG_PROPS} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg {...SVG_PROPS} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function IconCog() {
  return (
    <svg {...SVG_PROPS} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9 1.7 1.7 0 0 0 4.26 7.13L4.2 7.07A2 2 0 1 1 7.03 4.24l.06.06A1.7 1.7 0 0 0 9 4.64 1.7 1.7 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1h.04a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </svg>
  );
}
