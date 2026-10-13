import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { UpdateWindow } from "./components/UpdateWindow";
import { DesignPlayground } from "./components/DesignPlayground";
import "./styles.css";

const search = new URLSearchParams(window.location.search);
const showDesigner = search.has("designer") || search.has("design");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{search.has("updates") ? <UpdateWindow /> : showDesigner ? <DesignPlayground /> : <App />}</React.StrictMode>,
);
