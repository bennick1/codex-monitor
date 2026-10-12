import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { listenSidebarGlassInvalidated, syncSidebarGlass } from "../lib/bridge";
import { createSidebarGlassQueue, sampleSidebarGlass, type SidebarGlassOptions, type SidebarGlassStatus } from "../lib/sidebarGlass";

export function useSidebarGlass(root: RefObject<HTMLElement | null>, options: SidebarGlassOptions, revision: string): SidebarGlassStatus {
  const [status, setStatus] = useState<SidebarGlassStatus>("unsupported");
  const latest = useRef(options); latest.current = options;
  const refresh = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let stopped = false; let frame = 0; let force = false; let followup = false;
    const queue = createSidebarGlassQueue(syncSidebarGlass, setStatus);
    const sample = () => {
      frame = 0;
      if (stopped) return;
      queue.push(sampleSidebarGlass(element, latest.current), force);
      force = false;
      const moving = element.getAnimations?.({ subtree: true }).some(animation => animation.playState === "running" || animation.pending);
      if (moving || followup) { followup = false; frame = requestAnimationFrame(sample); }
    };
    const wake = (invalidate = false) => {
      if (stopped) return;
      force ||= invalidate;
      // The second paint sees transitions that have only just been created by style changes.
      followup = true;
      if (!frame) frame = requestAnimationFrame(sample);
    };
    const change = () => wake();
    const invalidate = () => wake(true);
    refresh.current = change;
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(change);
    resize?.observe(element);
    const mutations = new MutationObserver(() => {
      for (const surface of element.querySelectorAll(".sidebar-panel, .sidebar-dock")) resize?.observe(surface);
      wake();
    });
    mutations.observe(element, { subtree: true, attributes: true, attributeFilter: ["class", "style", "data-native-hover", "data-visible", "aria-expanded"], childList: true });
    for (const name of ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "pointerover", "pointerout", "focusin", "focusout"]) element.addEventListener(name, change);
    window.addEventListener("resize", invalidate);
    const unsubscribe = listenSidebarGlassInvalidated(invalidate).catch(() => () => {});
    wake(true);
    return () => {
      stopped = true; cancelAnimationFrame(frame); refresh.current = () => {};
      mutations.disconnect(); resize?.disconnect();
      for (const name of ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "pointerover", "pointerout", "focusin", "focusout"]) element.removeEventListener(name, change);
      window.removeEventListener("resize", invalidate);
      void unsubscribe.then(unlisten => unlisten());
      queue.dispose(sampleSidebarGlass(element, { ...latest.current, enabled: false }));
    };
  }, [root]);
  useLayoutEffect(() => { refresh.current(); }, [options.enabled, options.theme, options.side, options.dockHeight, options.surfaceOpacity, revision]);
  // System readability requirements still apply when the user disables blur.
  return status === "reducedTransparency" ? status : options.enabled ? status : "disabled";
}
