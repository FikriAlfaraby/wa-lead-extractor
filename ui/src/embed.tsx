import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import css from "./embed.css?inline";
import { SimulatorView } from "./SimulatorView";

/**
 * The simulator for fikrialfaraby.com/wa-lead/: mounts into
 * <div id="wa-lead-sim"> inside a shadow root, so the page's styles and the
 * simulator's cannot touch. The page's colour tokens (--accent, --surface,
 * ...) still reach it: custom properties inherit into shadow trees, so the
 * simulator follows the page's light and dark themes.
 */
const host = document.getElementById("wa-lead-sim");
if (host) {
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const mount = document.createElement("div");
  mount.className = "wl";
  shadow.append(style, mount);
  createRoot(mount).render(
    <StrictMode>
      <SimulatorView showHeader={false} initialScenarioId={host.dataset.scenario} />
    </StrictMode>
  );
}
