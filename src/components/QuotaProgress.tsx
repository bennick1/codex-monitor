import type { CSSProperties } from "react";
import type { WidgetSkin } from "../types";
import { MechaProgress } from "./MechaArtwork";

function BlurProgress({ percent, label }: { percent: number; label: string }) {
  const segmentCount = 20;
  const availableCount = Math.round((Math.max(0, Math.min(100, percent)) / 100) * segmentCount);
  return <div className="blur-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
    {Array.from({ length: segmentCount }, (_, index) => {
      const available = index < availableCount;
      const endWeight = available && availableCount > 1 ? (index / (availableCount - 1)) * 100 : 0;
      return <i key={index} className={available ? "is-available" : "is-used"} style={available ? { "--blur-progress-end-weight": `${endWeight}%` } as CSSProperties : undefined} aria-hidden="true" />;
    })}
  </div>;
}

function ComputerProgress({ percent, label }: { percent: number; label: string }) {
  const segmentCount = 34;
  const availableCount = Math.round((Math.max(0, Math.min(100, percent)) / 100) * segmentCount);
  return <div className="computer-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
    {Array.from({ length: segmentCount }, (_, index) => {
      const available = index < availableCount;
      const endWeight = available && availableCount > 1 ? (index / (availableCount - 1)) * 100 : 0;
      return <i key={index} className={available ? "is-available" : "is-used"} style={available ? { "--computer-progress-end-weight": `${endWeight}%` } as CSSProperties : undefined} aria-hidden="true" />;
    })}
  </div>;
}

/** Shared skin rendering for the floating card and compact menu-bar panel. */
export function QuotaProgress({ percent, label, skin }: { percent: number; label: string; skin: WidgetSkin }) {
  if (skin === "mecha-light") return <MechaProgress percent={percent} label={label} />;
  if (skin === "blur") return <BlurProgress percent={percent} label={label} />;
  if (skin === "computer") return <ComputerProgress percent={percent} label={label} />;
  return <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>;
}
