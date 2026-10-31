import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { getAuthClient } from "./services/auth";
import "./styles/index.css";

performance.mark("app:boot");

// Warm the Supabase auth client (chunk import + createClient) in parallel with
// React boot so the protected-route auth check is not the first thing to load it.
// getAuthClient() memoizes its promise, so RequireAuth reuses this same client.
void getAuthClient().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
