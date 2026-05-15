import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import AppBootstrap from "./components/AppBootstrap.tsx";

(() => {
  const pref = localStorage.getItem("deep-spec:dark");
  document.documentElement.classList.toggle("dark", pref !== "off");
})();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppBootstrap />
  </StrictMode>,
);
