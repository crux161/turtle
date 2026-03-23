import React from "react";
import { createRoot } from "react-dom/client";

import { TurtleApp } from "./TurtleApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TurtleApp />
  </React.StrictMode>,
);
