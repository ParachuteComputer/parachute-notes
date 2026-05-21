import { InsecureContextBanner } from "@/components/InsecureContextBanner";
import {
  type HubVaultEntry,
  type VaultRecord,
  beginOAuth,
  fetchHubVaults,
  hubOriginForVault,
  normalizeVaultUrl,
  useVaultStore,
} from "@/lib/vault";
import { InsecureContextError } from "@/lib/vault/pkce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

// One row per vault — connected (clickable to switch) or available (Connect
// button). Diffing rule: a hub entry whose URL matches a connected vault's URL
// belongs in Connected; the rest go to Available.
interface ConnectedRow {
  kind: "connected";
  id: string;
  label: string;
  isActive: boolean;
  hubKnown: boolean;
  vault: VaultRecord;
}

interface AvailableRow {
  kind: "available";
  name: string;
  url: string;
  hubOrigin: string;
}

export type VaultPopoverRow = ConnectedRow | AvailableRow;

function vaultDisplayLabel(v: VaultRecord): string {
  if (v.name) return v.name;
  try {
    return new URL(v.url).host;
  } catch {
    return v.url;
  }
}

function normalizedUrlForMatch(raw: string): string {
  try {
    return normalizeVaultUrl(raw);
  } catch {
    return raw.replace(/\/$/, "");
  }
}

/**
 * Compute the rows the popover should render given the locally-connected
 * vaults and the hub's published list. Pure function for easy testing.
 *
 * Matching is URL-based (normalized) — a hub entry with the same vault URL
 * as a connected record collapses into the Connected row (marked
 * `hubKnown: true`). Connected vaults whose URL isn't in the hub list still
 * render under Connected (with `hubKnown: false` so the UI can hint
 * "Hub doesn't know about this one" later if we want).
 */
export function buildVaultPopoverRows(
  connected: VaultRecord[],
  activeId: string | null,
  hubVaults: HubVaultEntry[],
  hubOriginForAvailable: string | null,
): VaultPopoverRow[] {
  const hubUrlSet = new Set(hubVaults.map((v) => normalizedUrlForMatch(v.url)));
  const connectedUrlSet = new Set(connected.map((v) => normalizedUrlForMatch(v.url)));

  const connectedRows: ConnectedRow[] = [...connected]
    .sort((a, b) => vaultDisplayLabel(a).localeCompare(vaultDisplayLabel(b)))
    .map((v) => ({
      kind: "connected" as const,
      id: v.id,
      label: vaultDisplayLabel(v),
      isActive: v.id === activeId,
      hubKnown: hubUrlSet.has(normalizedUrlForMatch(v.url)),
      vault: v,
    }));

  const availableRows: AvailableRow[] =
    hubOriginForAvailable === null
      ? []
      : hubVaults
          .filter((hv) => !connectedUrlSet.has(normalizedUrlForMatch(hv.url)))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((hv) => ({
            kind: "available" as const,
            name: hv.name,
            url: hv.url,
            hubOrigin: hubOriginForAvailable,
          }));

  return [...connectedRows, ...availableRows];
}

interface VaultPopoverProps {
  /**
   * Render variant. `header` is the desktop dropdown anchored to the trigger;
   * `inline` is the mobile menu where the popover sits in flow (no float, no
   * absolute positioning).
   */
  variant?: "header" | "inline";
}

export function VaultPopover({ variant = "header" }: VaultPopoverProps) {
  const navigate = useNavigate();
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const setActiveVault = useVaultStore((s) => s.setActiveVault);
  const activeVault = activeVaultId ? (vaults[activeVaultId] ?? null) : null;
  const [open, setOpen] = useState(false);
  const [hubVaults, setHubVaults] = useState<HubVaultEntry[] | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [insecureContext, setInsecureContext] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const hubOrigin = useMemo(
    () => (activeVault ? hubOriginForVault(activeVault) : null),
    [activeVault],
  );

  // Outside-click and Escape close the popover. Same shape as
  // SyncStatusIndicator — mousedown so a click that selects something inside
  // doesn't fire before the click handler.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Fetch the hub's vault list when the popover opens. Refetched per-open so
  // newly-added vaults show up without a page reload; cheap (one same-origin
  // GET to a static-ish JSON).
  useEffect(() => {
    if (!open || !hubOrigin) {
      return;
    }
    const ctrl = new AbortController();
    fetchHubVaults(hubOrigin, fetch.bind(globalThis), ctrl.signal).then((result) => {
      if (ctrl.signal.aborted) return;
      setHubVaults(result);
    });
    return () => ctrl.abort();
  }, [open, hubOrigin]);

  const rows = useMemo(
    () => buildVaultPopoverRows(Object.values(vaults), activeVaultId, hubVaults ?? [], hubOrigin),
    [vaults, activeVaultId, hubVaults, hubOrigin],
  );
  const connectedRows = rows.filter((r): r is ConnectedRow => r.kind === "connected");
  const availableRows = rows.filter((r): r is AvailableRow => r.kind === "available");

  const triggerLabel = activeVault ? vaultDisplayLabel(activeVault) : "Choose vault";

  const onSwitch = useCallback(
    (id: string) => {
      setActiveVault(id);
      setOpen(false);
    },
    [setActiveVault],
  );

  const onConnect = useCallback(async (row: AvailableRow) => {
    setConnecting(row.name);
    setConnectError(null);
    setInsecureContext(false);
    try {
      // Path A (design doc §2): pass `vault=<name>` as a hint. Pre-#240 hubs
      // ignore it and the consent screen renders the picker as today; future
      // hubs can pre-select on the consent screen with no Notes change.
      const { authorizeUrl } = await beginOAuth(row.hubOrigin, undefined, undefined, {
        params: { vault: row.name },
      });
      window.location.assign(authorizeUrl);
    } catch (err) {
      setConnecting(null);
      // Insecure-context failure has a distinct remediation path (use
      // localhost, or terminate HTTPS upstream) — surface it with the
      // dedicated banner instead of jamming the long actionable message
      // into the popover's thin error line.
      if (err instanceof InsecureContextError) {
        setInsecureContext(true);
      } else {
        setConnectError((err as Error).message);
      }
    }
  }, []);

  const onManage = useCallback(() => {
    setOpen(false);
    navigate("/vaults");
  }, [navigate]);

  const panel = (
    // biome-ignore lint/a11y/useSemanticElements: a native <dialog> requires imperative show()/showModal() calls; this is a popover, not a modal.
    <div
      role="dialog"
      aria-label="Vaults"
      className={
        variant === "header"
          ? "absolute right-0 z-30 mt-2 w-72 rounded-md border border-border bg-card text-sm shadow-lg"
          : "mt-2 w-full rounded-md border border-border bg-card text-sm"
      }
    >
      {connectedRows.length > 0 ? (
        <div className="border-b border-border">
          <div className="px-3 pt-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-dim">
            Connected
          </div>
          <ul className="pb-2">
            {connectedRows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onSwitch(row.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent/5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                        row.isActive ? "bg-accent" : "border border-border bg-transparent"
                      }`}
                    />
                    <span className="truncate text-fg">{row.label}</span>
                  </span>
                  {row.isActive ? (
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-accent">
                      current
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {availableRows.length > 0 ? (
        <div className="border-b border-border">
          <div className="px-3 pt-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-dim">
            Available from your hub
          </div>
          <ul className="pb-2">
            {availableRows.map((row) => (
              <li key={row.url}>
                <div className="flex w-full items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 shrink-0 rounded-full border border-border"
                    />
                    <span className="truncate text-fg-muted">{row.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onConnect(row)}
                    disabled={connecting === row.name}
                    className="shrink-0 rounded border border-accent/40 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-60"
                  >
                    {connecting === row.name ? "Connecting…" : "Connect"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insecureContext ? (
        <div className="border-b border-border px-3 py-2">
          <InsecureContextBanner />
        </div>
      ) : null}

      {connectError ? (
        <div className="border-b border-border px-3 py-2 text-xs text-red-400">{connectError}</div>
      ) : null}

      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={onManage}
          className="text-xs text-fg-muted hover:text-accent"
        >
          Manage vaults →
        </button>
        {hubOrigin && hubVaults === null && open ? (
          <span className="text-[10px] text-fg-dim">Loading hub vaults…</span>
        ) : null}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={variant === "header" ? "relative max-w-full" : ""}>
      <button
        type="button"
        aria-label={`Active vault: ${triggerLabel}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        // `title` mirrors the visible label so sighted users can hover to
        // see the full vault name when the rem-capped trigger truncates it
        // (notes#147 reviewer). Inline variant lays out at full width so
        // the title is harmless redundancy there.
        title={variant === "header" ? triggerLabel : undefined}
        className={
          variant === "header"
            ? // `max-w-[12rem]` caps the trigger at a rem-based width so a
              // long vault name truncates instead of pushing header siblings
              // out (notes#136). rem so the cap scales with text-size.
              "flex min-w-0 max-w-[12rem] items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-fg hover:border-accent/50"
            : "flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm text-fg"
        }
      >
        <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent" />
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <span aria-hidden className="ml-1 shrink-0 text-xs text-fg-dim">
          ▾
        </span>
      </button>

      {open ? panel : null}
    </div>
  );
}
