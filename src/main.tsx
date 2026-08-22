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
