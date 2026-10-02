import { useEffect, useRef, useState } from "react";
import type { Language } from "../types";
import patches from "../../assets/mecha-light/tabs-reference-exact/label-patches.json";

export type MechaTabTone = "healthy" | "caution" | "critical" | "unknown";
type LabelKey = "overview" | "models" | "turns";
type Patch = (typeof patches.entries)[number];
const colors = { healthy: "blue", caution: "amber", critical: "red" } as const;
const assets = import.meta.glob<string>("../../assets/mecha-light/tabs-reference-exact/*.png", {
  eager: true, query: "?url", import: "default",
});
const assetUrl = (name: string) => assets[`../../assets/mecha-light/tabs-reference-exact/${name}`];

// Narrow skin decoration for these three labels only. The real translated span
// remains the button's sole accessible naming path in every state.
export function MechaTabLabel({ labelKey, text, language, tone, active }: {
  labelKey: LabelKey; text: string; language: Language; tone?: MechaTabTone; active: boolean;
}) {
  const color = tone && tone !== "unknown" ? colors[tone] : undefined;
  const requested = language === "zh-CN" && color !== undefined;
  const patch = requested ? patches.entries.find(p => p.locale === language && p.labelKey === labelKey
    && p.color === color && p.renderState === (active ? "active" : "idle")) : undefined;
  // A new identity mounts fresh loading state. Late decode from a previous
  // language, skin, color or selected state cannot hide the current label.
  const identity = `${language}:${tone ?? "text"}:${labelKey}:${active}:${patch?.id ?? "none"}`;
  return <DecodedLabel key={identity} identity={identity} patch={patch} text={text} requested={requested} />;
}

function DecodedLabel({ identity, patch, text, requested }: {
  identity: string; patch?: Patch; text: string; requested: boolean;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<"text" | "missing" | "loading" | "ready" | "error">(
    requested ? (patch ? "loading" : "missing") : "text");
  const src = patch && assetUrl(patch.asset);
  const background = patch && assetUrl(patch.panelAsset);
  useEffect(() => {
    let current = true;
    if (!requested) return;
    if (!patch || !src || !background || !image.current) {
      setStatus("missing");
      console.warn("[MechaTabLabel] Missing background-bound label mapping", identity);
      return;
    }
    const label = image.current;
    const panel = new Image();
    panel.src = background;
    // Both layers must decode before the visible font is replaced. Keeping the
    // patch hidden until then also avoids a rectangle over an unloaded panel.
    Promise.resolve().then(() => Promise.all([label.decode(), panel.decode()])).then(() => {
      if (!current) return;
      if (label.naturalWidth !== patch.size[0] || label.naturalHeight !== patch.size[1]) {
        throw new Error("Unexpected label patch dimensions");
      }
      setStatus("ready");
    }).catch(error => {
      if (!current) return;
      setStatus("error");
      console.warn("[MechaTabLabel] Decode failed; showing real text", identity, error);
    });
    return () => { current = false; };
  }, [identity, patch, requested, src, background]);
  return <>
    <span className="token-tab-label" data-label-status={status}>{text}</span>
    {patch && src ? <img ref={image} className="mecha-tab-label-patch" src={src}
      alt="" aria-hidden="true" draggable={false} data-ready={status === "ready"}
      data-patch-id={patch.id} width={patch.size[0]} height={patch.size[1]}
      style={{ left: patch.buttonRectangle[0], top: patch.buttonRectangle[1] }} /> : null}
  </>;
}
