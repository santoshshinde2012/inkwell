import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import "../ui/global.css";

const el = document.getElementById("root");
if (!el) throw new Error("options root missing");

createRoot(el).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
