import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { TrayPopover } from "./app/TrayPopover";
import { bootstrap } from "./store";
import "./styles.css";

void bootstrap();

// One bundle, two windows: the main window and the menu bar popover.
const isPopover = getCurrentWindow().label === "popover";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isPopover ? <TrayPopover /> : <App />}</React.StrictMode>,
);
