// ─── Iframe error interception ─────────────────────────────────────────────
// The @vly-ai/integrations Vite plugin injects window-level `error` and
// `unhandledrejection` handlers (bubble phase) that post vly-vite-hmr-error
// to the parent, which Freebuff interprets as a fatal crash and closes the
// preview iframe.  Our capture-phase handlers run BEFORE the injected ones
// and call stopImmediatePropagation() + preventDefault() to swallow the
// event, preventing it from reaching the injected handlers.
if (typeof window !== "undefined") {
  window.addEventListener(
    "error",
    (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      // eslint-disable-next-line no-console
      console.error("[iframe-guard] error:", e.message, e.filename, e.lineno);
    },
    true, // capture phase — fires before injected bubble-phase handlers
  );
  window.addEventListener(
    "unhandledrejection",
    (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      // eslint-disable-next-line no-console
      console.error("[iframe-guard] unhandledrejection:", e.reason);
    },
    true,
  );
}

import { createRoot } from "react-dom/client";
import React from "react";

createRoot(document.getElementById("root")!).render(
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#00ff41",
      fontFamily: "monospace",
      fontSize: "2rem",
    }}
  >
    PREVIEW_BOOT_OK
  </div>,
);
