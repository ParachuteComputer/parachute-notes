import { BottomTabBar } from "@/components/BottomTabBar";
import { Header } from "@/components/Header";
import { QuickSwitchMount } from "@/components/QuickSwitchMount";
import { ReconnectBanner } from "@/components/ReconnectBanner";
import { Toaster } from "@/components/Toaster";
import { UpdateBanner } from "@/components/UpdateBanner";
import { useVaultStore } from "@/lib/vault";
import { useCrossTabVaultSync } from "@/lib/vault/cross-tab-sync";
import { QueryProvider } from "@/providers/QueryProvider";
import { SyncProvider } from "@/providers/SyncProvider";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router";
import { Activity } from "./routes/Activity";
import { AddVault } from "./routes/AddVault";
import { Calendar } from "./routes/Calendar";
import { Capture } from "./routes/Capture";
import { Home } from "./routes/Home";
import { NoteEditor } from "./routes/NoteEditor";
import { NoteNew } from "./routes/NoteNew";
import { NoteView } from "./routes/NoteView";
import { Notes } from "./routes/Notes";
import { OAuthCallback } from "./routes/OAuthCallback";
import { Settings } from "./routes/Settings";
import { Tags } from "./routes/Tags";
import { Today } from "./routes/Today";
import { VaultGraph } from "./routes/VaultGraph";
import { Vaults } from "./routes/Vaults";

// Index dispatcher: render the notes list when a vault is connected, else the
// landing page. Both live at internal `/`, which maps to external `/notes/`
// via BrowserRouter's basename. Keeps Notes free of "no vault?" presentation
// concerns and Home free of any redirect logic.
function NotesIndex() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  return activeVault ? <Notes /> : <Home />;
}

// Shim for pre-mount external bookmarks. When the app lived at the origin root,
// links were `/<id>` and `/<id>/edit`. After the frontend moved under its own
// mount (now `/notes/`), Tailscale strips that prefix, leaving internal
// `/<id>` and `/<id>/edit` — which the catch-all would otherwise bounce to
// `/`. Redirect them to the canonical `/n/<id>` routes so old bookmarks
// survive.
function NoteIdRedirect({ suffix = "" }: { suffix?: string }) {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/" replace />;
  return <Navigate to={`/n/${encodeURIComponent(id)}${suffix}`} replace />;
}

export function App() {
  // Wired at the app root (not a provider) so the storage-event listener
  // outlives every route transition. Same vault state surfaces in every tab
  // without a refresh.
  useCrossTabVaultSync();
  return (
    <QueryProvider>
      <SyncProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || undefined}>
          <div className="min-h-dvh overflow-x-hidden bg-bg text-fg pb-16 md:pb-0">
            <Toaster />
            <UpdateBanner />
            <ReconnectBanner />
            <Header />
            <QuickSwitchMount />
            <main>
              <Routes>
                <Route path="/" element={<NotesIndex />} />
                <Route path="/pinned" element={<Notes preset="pinned" />} />
                <Route path="/archived" element={<Notes preset="archived" />} />
                <Route path="/untagged" element={<Notes preset="untagged" />} />
                <Route path="/orphaned" element={<Notes preset="orphaned" />} />
                <Route path="/tags" element={<Tags />} />
                <Route path="/new" element={<NoteNew />} />
                <Route path="/capture" element={<Capture />} />
                <Route path="/graph" element={<VaultGraph />} />
                <Route path="/today" element={<Today />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/activity" element={<Activity />} />
                <Route path="/n/:id" element={<NoteView />} />
                <Route path="/n/:id/edit" element={<NoteEditor />} />
                <Route path="/:id" element={<NoteIdRedirect />} />
                <Route path="/:id/edit" element={<NoteIdRedirect suffix="/edit" />} />
                <Route path="/add" element={<AddVault />} />
                <Route path="/oauth/callback" element={<OAuthCallback />} />
                <Route path="/vaults" element={<Vaults />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
            <BottomTabBar />
            <footer className="mx-auto max-w-5xl px-6 py-10 text-center text-sm text-fg-dim">
              <p>
                Part of the{" "}
                <a href="https://parachute.computer" className="text-accent hover:underline">
                  Parachute Computer
                </a>{" "}
                ecosystem. AGPL-3.0.
              </p>
            </footer>
          </div>
        </BrowserRouter>
      </SyncProvider>
    </QueryProvider>
  );
}
