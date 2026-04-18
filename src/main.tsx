import { App } from "@/app/App";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
