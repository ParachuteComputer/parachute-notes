import { useVaultReachabilityStore } from "@/lib/vault/reachability-store";
import { useVaultStore } from "@/lib/vault/store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (failureCount, error) => {
              if (!(error instanceof Error)) return failureCount < 2;
              // Auth errors throw immediately; refresh.ts owns the recovery
              // path. Retrying here would only mask the halt-store transition.
              if (error.name === "VaultAuthError") return false;
              // Vault unreachable — the reachability store + probe hook own
              // recovery (exponential backoff probe of /api/vault). Once we've
              // crossed the `down` threshold there's no value in React Query
              // also retrying; that's the source of the 404 hammering Aaron
              // saw in the vault log. While still in `retrying` (≤2
              // consecutive failures) allow one retry so a single transient
              // blip self-heals without the banner ever appearing.
              if (error.name === "VaultUnreachableError") {
                const activeId = useVaultStore.getState().activeVaultId;
                const state = activeId
                  ? useVaultReachabilityStore.getState().byVault[activeId]?.state
                  : undefined;
                if (state === "down") return false;
                return failureCount < 1;
              }
              return failureCount < 2;
            },
            refetchOnWindowFocus: false,
            staleTime: 10_000,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
