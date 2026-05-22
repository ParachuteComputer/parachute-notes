import { useEffect } from "react";
import { useActiveVaultClient } from "./queries";
import { useSchemaAuditStore } from "./schema-audit-store";
import { useVaultStore } from "./store";

// Auto-runs the schema audit when the active vault (or its client)
// changes. Wired once at the App root via `<SchemaAuditRunnerMount />` —
// no DOM, only an effect — so the Settings panel and the connect-time
// banner can both read the cached result without re-fetching. Uses the
// store's `ensure` (cache-respecting); manual refresh in Settings calls
// `refresh` directly.
export function useSchemaAuditRunner(): void {
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const client = useActiveVaultClient();
  const ensure = useSchemaAuditStore((s) => s.ensure);

  useEffect(() => {
    if (!activeVaultId || !client) return;
    void ensure(activeVaultId, client);
  }, [activeVaultId, client, ensure]);
}

export function SchemaAuditRunnerMount(): null {
  useSchemaAuditRunner();
  return null;
}
