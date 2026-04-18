import { Header } from "@/components/Header";
import { QueryProvider } from "@/providers/QueryProvider";
import { BrowserRouter, Route, Routes } from "react-router";
import { AddVault } from "./routes/AddVault";
import { Home } from "./routes/Home";
import { Notes } from "./routes/Notes";
import { OAuthCallback } from "./routes/OAuthCallback";
import { Vaults } from "./routes/Vaults";

export function App() {
  return (
    <QueryProvider>
      <BrowserRouter>
        <div className="min-h-dvh bg-bg text-fg">
          <Header />
          <main>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/notes" element={<Notes />} />
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
    </QueryProvider>
  );
}
