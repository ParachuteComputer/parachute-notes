import { Header } from "@/components/Header";
import { Toaster } from "@/components/Toaster";
import { UpdateBanner } from "@/components/UpdateBanner";
import { QueryProvider } from "@/providers/QueryProvider";
import { SyncProvider } from "@/providers/SyncProvider";
import { BrowserRouter, Route, Routes } from "react-router";
import { AddVault } from "./routes/AddVault";
import { Home } from "./routes/Home";
import { NoteEditor } from "./routes/NoteEditor";
import { NoteNew } from "./routes/NoteNew";
import { NoteView } from "./routes/NoteView";
import { Notes } from "./routes/Notes";
import { OAuthCallback } from "./routes/OAuthCallback";
import { Tags } from "./routes/Tags";
import { VaultGraph } from "./routes/VaultGraph";
import { Vaults } from "./routes/Vaults";

export function App() {
  return (
    <QueryProvider>
      <SyncProvider>
        <BrowserRouter>
          <div className="min-h-dvh bg-bg text-fg">
            <Toaster />
            <UpdateBanner />
            <Header />
            <main>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/notes" element={<Notes />} />
                <Route path="/tags" element={<Tags />} />
                <Route path="/new" element={<NoteNew />} />
                <Route path="/graph" element={<VaultGraph />} />
                <Route path="/notes/:id" element={<NoteView />} />
                <Route path="/notes/:id/edit" element={<NoteEditor />} />
                <Route path="/add" element={<AddVault />} />
                <Route path="/oauth/callback" element={<OAuthCallback />} />
                <Route path="/vaults" element={<Vaults />} />
                <Route path="*" element={<Home />} />
              </Routes>
            </main>
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
