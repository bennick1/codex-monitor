import { ArrowClockwise, ArrowLeft, ArrowRight, ArrowUp, GearSix, PushPin, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ProviderSnapshot, WidgetPreferences, WidgetTheme } from "../types";
import { deepSeekSession, getAccountUsage, getAutostart, getDeepSeekUsage, listenDeepSeekReady, listenSidebarRecovery, listenSidebarDismiss, listenSidebarPointer, setAlwaysOnTop, setSidebarPhase, syncSidebarRegions, sidebarAction, type SidebarPhase, type SidebarPointer } from "../lib/bridge";
import { sidebarInputRegions } from "../lib/widgetGeometry";
import { useSidebarGlass } from "../hooks/useSidebarGlass";
import { accountDays, formatMoney, durationText, EMPTY_DEEPSEEK, formatTokenCount, formatTokenCountExact, remainingFunds, sidebarQuotaWindows, sumTokens, type AccountUsage, type DeepSeekUsage } from "../lib/sidebarData";
import { formatDateTime, formatResetTime } from "../lib/format";
import codexLogo from "../../assets/codex-mark.svg";
import deepSeekLogo from "../../assets/deepseek.svg";
import "./sidebar.css";

const EXIT_MS = 150;
const DETAIL_LEAVE_MS = 120;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function ActionArc({ children }: { children: ReactNode }) {
  return <><svg className="sidebar-action-arc" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="21" pathLength="100" transform="rotate(-90 24 24)" />
  </svg><span className="sidebar-action-icon" aria-hidden="true">{children}</span></>;
}

function Metric({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return <div className="sidebar-metric"><dt>{label}</dt><dd title={title}>{value}</dd></div>;
}
function TokenMetric({ label, value }: { label: string; value?: string | null }) {
  return <Metric label={label} value={formatTokenCount(value)} title={formatTokenCountExact(value)} />;
}
function Chart({ label, days, money = false, locale = "zh-CN", currency = "CNY" }: { label: string; days: { date: string; value: string | null }[]; money?: boolean; locale?: string; currency?: string }) {
  const values = days.map(day => day.value && /^\d+$/.test(day.value) ? BigInt(day.value) : 0n);
  const max = values.reduce((a, b) => a > b ? a : b, 1n);
  return <figure className="sidebar-chart"><figcaption>{label}</figcaption><div className="sidebar-bars" role="img" aria-label={label}>
    {days.map((day, i) => <span key={day.date} tabIndex={0} aria-label={`${day.date}: ${day.value === null ? "—" : money ? formatMoney(Number(day.value) / 1000000, locale, currency) : formatTokenCountExact(day.value)}`}
      title={`${day.date}: ${day.value === null ? "—" : money ? formatMoney(Number(day.value) / 1000000, locale, currency) : formatTokenCountExact(day.value)}`}
      className={day.value === null ? "sidebar-bar--missing" : ""} style={{ height: `${values[i] === 0n ? 2 : Math.max(3, Number(values[i] * 1000n / max) / 10)}%` }} />)}
  </div></figure>;
}

export function Sidebar({ snapshot, preferences, theme, onPreferences, onRefresh, notice }: {
  snapshot: ProviderSnapshot; preferences: WidgetPreferences; theme: WidgetTheme;
  onPreferences: (value: WidgetPreferences) => void; onRefresh: () => void; notice: string | null;
}) {
  const zh = preferences.language === "zh-CN";
  const showCodex = preferences.sidebarShowCodex !== false;
  const showDeepseek = preferences.sidebarShowDeepseek !== false;
  const providerCount = Number(showCodex) + Number(showDeepseek);
  const side = preferences.sidebarSide ?? "right";
  const nextSide = side === "right" ? "left" : side === "left" ? "top" : "right";
  const dockHeight = providerCount === 2 ? 180 : providerCount === 1 ? 98 : 60;
  const [phase, setPhase] = useState<SidebarPhase>(preferences.stayExpanded ? "rail" : "handle");
  const [panelPhase, setPanelPhase] = useState<"detail" | "menu" | null>(null);
  const [provider, setProvider] = useState<"codex" | "deepseek">("codex");
  const [account, setAccount] = useState<AccountUsage | null>(null);
  const [accountStatus, setAccountStatus] = useState("loading");
  const [deepseek, setDeepseek] = useState<DeepSeekUsage>(EMPTY_DEEPSEEK);
  const [error, setError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(preferences.sidebarOpacity ?? 0.9);
  const [scaleChoice, setScaleChoice] = useState(preferences.sidebarScale ?? 1);
  const [scale, setScale] = useState(preferences.sidebarScale ?? 1);
  const [scaleLimited, setScaleLimited] = useState(false);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => new Date());
  const root = useRef<HTMLElement>(null);
  const timer = useRef<number | null>(null);
  const detailTimer = useRef<number | null>(null);
  const detailHovered = useRef(false);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const pinned = useRef(preferences.stayExpanded); pinned.current = preferences.stayExpanded;
  const inside = useRef(false); const focused = useRef(false);
  const nativeTracking = useRef(false);
  const nativePointer = useRef<SidebarPointer | null>(null);
  const nativeMovement = useRef<number | null>(null);
  const resizeNativeMovement = useRef<number | null>(null);
  const [nativeTarget, setNativeTarget] = useState<string | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const keyboardInput = useRef(true);
  const refreshPending = useRef(false);
  const refreshAgain = useRef(false);
  const phaseSequence = useRef(0);
  const motionTimer = useRef<number | null>(null);
  const pendingPhase = useRef<SidebarPhase | null>(null);
  const nativePhase = useRef<SidebarPhase | null>(null);
  const panel = useRef<HTMLElement>(null);
  const panelHeight = useRef(0);
  const panelWasDetail = useRef(false);
  const panelAnimation = useRef<Animation | null>(null);
  const reportedRegions = useRef("");
  const resizing = useRef(false);
  const viewportNeedsSync = useRef(false);
  const viewportSyncPending = useRef(false);
  const synchronizeViewport = useRef<() => void>(() => {});
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const resizePointer = useRef<{ x: number; y: number } | null>(null);
  const glassStatus = useSidebarGlass(root, { theme, enabled: preferences.sidebarGlassEnabled !== false, side, dockHeight, surfaceOpacity: opacity }, `${phase}:${panelPhase}:${provider}:${layoutRevision}:${scale}`);
  const words = (cn: string, en: string) => zh ? cn : en;
  const cancelCollapse = useCallback(() => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null; }, []);
  const cancelDetailCollapse = useCallback(() => { if (detailTimer.current !== null) window.clearTimeout(detailTimer.current); detailTimer.current = null; }, []);
  const changePhase = useCallback((next: SidebarPhase, preserveCollapseTimer = false) => {
    if (!preserveCollapseTimer) cancelCollapse();
    cancelDetailCollapse();
    if (pendingPhase.current === next || (!pendingPhase.current && phaseRef.current === next)) return;
    const reversingExit = motionTimer.current !== null && nativePhase.current === next;
    if (motionTimer.current !== null) window.clearTimeout(motionTimer.current);
    motionTimer.current = null;
    const sequence = ++phaseSequence.current;
    if (reversingExit) {
      // The native footprint never shrank: reverse the existing CSS transition
      // immediately instead of waiting for a redundant round trip to AppKit.
      pendingPhase.current = null;
      resizing.current = false;
      setPhase(next); phaseRef.current = next;
      setPanelPhase(current => next === "detail" || next === "menu" ? next : current === "detail" ? current : null);
      if (viewportNeedsSync.current) synchronizeViewport.current();
      return;
    }
    pendingPhase.current = next;
    const previous = phaseRef.current;
    resizing.current = true;
    // Prepare a hidden detail while the bridge waits for its real viewport.
    if (next === "detail") setPanelPhase("detail");
    // Keep the old footprint for the exit; mounted layers can reverse mid-hover.
    if (next === "handle" || next === "rail") { setPhase(next); phaseRef.current = next; }
    const resize = () => {
      motionTimer.current = null;
      resizePointer.current = pointerPosition.current;
      resizeNativeMovement.current = nativeMovement.current;
      void setSidebarPhase(next).then(viewport => {
        nativePhase.current = next;
        if (sequence !== phaseSequence.current) return;
        if (viewport?.scale) setScale(viewport.scale);
        setPhase(next); phaseRef.current = next;
        setPanelPhase(current => next === "detail" || next === "menu" ? next : current === "detail" ? current : null);
      }).catch(() => {
        if (sequence !== phaseSequence.current) return;
        setPhase(previous); phaseRef.current = previous;
        setError(zh ? "侧边窗口调整失败，请重新打开应用。" : "Could not resize sidebar. Reopen the app.");
      }).finally(() => {
        if (sequence === phaseSequence.current) {
          pendingPhase.current = null;
          resizing.current = false;
          setLayoutRevision(value => value + 1);
          if (viewportNeedsSync.current) synchronizeViewport.current();
        }
      });
    };
    const shrinking = (next === "handle" && previous !== "handle")
      || (next === "rail" && (previous === "detail" || previous === "menu"));
    if (shrinking && !reducedMotion()) motionTimer.current = window.setTimeout(resize, EXIT_MS);
    else resize();
  }, [cancelCollapse, cancelDetailCollapse, zh]);
  useEffect(() => () => {
    phaseSequence.current++;
    if (motionTimer.current !== null) window.clearTimeout(motionTimer.current);
    if (detailTimer.current !== null) window.clearTimeout(detailTimer.current);
    panelAnimation.current?.cancel();
  }, []);
  useLayoutEffect(() => {
    const element = panel.current;
    const wasDetail = panelWasDetail.current;
    const isDetail = phase === "detail" && panelPhase === "detail";
    panelWasDetail.current = isDetail;
    const from = panelAnimation.current?.playState === "running"
      ? element?.offsetHeight ?? 0 : panelHeight.current;
    panelAnimation.current?.cancel();
    panelAnimation.current = null;
    const to = element?.offsetHeight ?? 0;
    panelHeight.current = isDetail ? to : 0;
    // Only this small surface interpolates height; the OS window stays fixed.
    if (element?.animate && wasDetail && isDetail && from && to && Math.abs(from - to) > 1 && !reducedMotion()) {
      panelAnimation.current = element.animate([{ height: `${from}px`, overflow: "hidden" }, { height: `${to}px`, overflow: "hidden" }], {
        duration: 180, easing: "cubic-bezier(.2,.8,.2,1)",
      });
    }
  }, [phase, panelPhase, provider, accountStatus, deepseek.status]);
  useLayoutEffect(() => {
    const report = () => {
      const committed = nativePhase.current ?? phase;
      const hitPhase = motionTimer.current !== null ? committed : phase;
      const element = panel.current;
      const regions = sidebarInputRegions(window.innerWidth, window.innerHeight, preferences.sidebarSide ?? "right", hitPhase,
        dockHeight, element ? { width: element.offsetWidth, height: element.offsetHeight } : undefined, scale);
      const key = JSON.stringify([committed, regions]);
      if (reportedRegions.current === key) return;
      reportedRegions.current = key;
      void syncSidebarRegions(committed, regions).catch(() => {
        reportedRegions.current = "";
        setError(zh ? "侧边栏交互区域更新失败，请重新打开应用。" : "Could not update sidebar input. Reopen the app.");
      });
    };
    report();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    if (panel.current) observer?.observe(panel.current);
    window.addEventListener("resize", report);
    return () => { observer?.disconnect(); window.removeEventListener("resize", report); };
  }, [phase, panelPhase, provider, layoutRevision, preferences.sidebarSide, dockHeight, scale, zh]);
  const scheduleCollapse = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (!inside.current && !focused.current && phaseRef.current !== "menu" && !pinned.current) changePhase("handle");
    }, 450);
  }, [changePhase]);
  const scheduleDetailCollapse = useCallback(() => {
    if (detailTimer.current !== null || (phaseRef.current !== "detail" && pendingPhase.current !== "detail")) return;
    detailTimer.current = window.setTimeout(() => {
      detailTimer.current = null;
      if (!detailHovered.current && !focused.current && phaseRef.current === "detail") {
        // Closing a detail must not postpone the rail's existing leave deadline.
        changePhase("rail", true);
      }
    }, DETAIL_LEAVE_MS);
  }, [changePhase]);
  const trackDetailHover = useCallback((target: Element | null, point?: { x: number; y: number }) => {
    detailHovered.current = Boolean(target?.closest(".sidebar-provider, .sidebar-detail[data-visible=true]"));
    const exitingDetail = pendingPhase.current === "rail" && motionTimer.current !== null && nativePhase.current === "detail";
    if (!detailHovered.current && point && (phaseRef.current === "detail" || exitingDetail)) {
      const detail = panel.current?.getBoundingClientRect();
      const dock = root.current?.querySelector(".sidebar-dock")?.getBoundingClientRect();
      if (detail?.width && detail.height && dock?.width && dock.height) {
        // Include only the corridor between the two surfaces, not the gear or
        // unrelated rail blanks. Fading content stays recoverable until resize.
        const left = detail.left >= dock.right ? dock.right : detail.right;
        const right = detail.left >= dock.right ? detail.left : dock.left;
        const inDetail = point.x >= detail.left && point.x <= detail.right && point.y >= detail.top && point.y <= detail.bottom;
        const inCorridor = side === "top"
          ? point.y >= dock.bottom && point.y <= detail.top
            && point.x >= Math.max(detail.left, dock.left) && point.x <= Math.min(detail.right, dock.right)
          : point.x >= left && point.x <= right
            && point.y >= Math.max(detail.top, dock.top) && point.y <= Math.min(detail.bottom, dock.bottom);
        detailHovered.current = inDetail || inCorridor;
      }
    }
    if (detailHovered.current) {
      cancelDetailCollapse();
      if (exitingDetail) changePhase("detail");
    }
    else scheduleDetailCollapse();
  }, [cancelDetailCollapse, scheduleDetailCollapse, changePhase, side]);
  const dismissMenu = useCallback(() => {
    if (phaseRef.current !== "menu") return;
    inside.current = false; focused.current = false;
    (document.activeElement as HTMLElement)?.blur();
    changePhase(pinned.current ? "rail" : "handle");
  }, [changePhase]);
  const showDetail = useCallback((id: "codex" | "deepseek", pointer?: { screenX: number; screenY: number }) => {
    if (phaseRef.current === "menu") return;
    if (id === "codex" ? !showCodex : !showDeepseek) return;
    if (pointer) {
      // Once native tracking is available it owns hover selection. WebKit may
      // deliver a duplicate enter for an old layout after the window resizes.
      if (nativeTracking.current) return;
      const position = { x: pointer.screenX, y: pointer.screenY };
      pointerPosition.current = position;
      // AppKit may dispatch enter/move after the resize promise resolves. A
      // stationary screen pointer is layout motion, not a new provider choice.
      if (resizePointer.current?.x === position.x && resizePointer.current.y === position.y) return;
      resizePointer.current = null;
      if (resizing.current && !(pendingPhase.current === "rail" && motionTimer.current !== null)) return;
    }
    detailHovered.current = true;
    cancelDetailCollapse();
    setProvider(id);
    if (phaseRef.current !== "detail") changePhase("detail");
  }, [changePhase, showCodex, showDeepseek, cancelDetailCollapse]);
  useEffect(() => {
    if (phaseRef.current !== "detail" || (provider === "codex" ? showCodex : showDeepseek)) return;
    if (showCodex || showDeepseek) setProvider(showCodex ? "codex" : "deepseek");
    else changePhase("rail");
  }, [provider, showCodex, showDeepseek, changePhase]);
  const resolveNativeHover = useCallback((pointer: SidebarPointer) => {
    if (!pointer.inside) { setNativeTarget(null); trackDetailHover(null); return; }
    const position = pointer.position;
    if (!position || (resizing.current && !(pendingPhase.current === "rail" && motionTimer.current !== null)) || phaseRef.current === "handle") return;
    // Reject samples from the previous native footprint and stationary pointer
    // samples caused solely by moving/resizing the window under the cursor.
    if (Math.abs(position.width - window.innerWidth) > 1 || Math.abs(position.height - window.innerHeight) > 1) return;
    const element = document.elementFromPoint(position.x, position.y);
    trackDetailHover(element, position);
    // Region updates may change presence beneath a stationary cursor. Keep the
    // current detail held, but do not turn layout changes into provider choices.
    if (position.movement === resizeNativeMovement.current) return;
    const target = element?.closest<HTMLElement>("[data-sidebar-hover]");
    const id = target && root.current?.contains(target) ? target.dataset.sidebarHover ?? null : null;
    setNativeTarget(id);
    if (id === "codex" || id === "deepseek") showDetail(id);
  }, [showDetail, trackDetailHover]);
  const trackNativePointer = useCallback((value: SidebarPointer) => {
    nativeTracking.current = true;
    nativePointer.current = value;
    const position = value.position;
    if (position) nativeMovement.current = position.movement;
    // Validate before changing either presence or phase. The old top margin
    // can still send enters while the native frame and WebView are settling.
    if ((resizing.current && motionTimer.current === null)
      || (position && (Math.abs(position.width - window.innerWidth) > 1 || Math.abs(position.height - window.innerHeight) > 1))) return;
    if (value.inside && position?.movement === resizeNativeMovement.current && phaseRef.current === "handle") return;
    let entered = value.inside;
    if (entered && position && phaseRef.current === "handle" && pendingPhase.current === "handle") {
      // Reverse over the closing dock, not the old transparent window margins.
      // Use its resting bounds so the animated transform cannot move the target.
      const bounds = sidebarInputRegions(window.innerWidth, window.innerHeight, preferences.sidebarSide ?? "right", "rail", dockHeight, undefined, scale)[0];
      entered = Boolean(bounds && position.x >= bounds.x && position.x <= bounds.x + bounds.width
        && position.y >= bounds.y && position.y <= bounds.y + bounds.height);
    }
    inside.current = entered;
    if (entered) {
      cancelCollapse();
      if (phaseRef.current === "handle") { changePhase("rail"); return; }
    } else {
      scheduleCollapse();
    }
    resolveNativeHover(entered ? value : { inside: false });
  }, [cancelCollapse, changePhase, scheduleCollapse, resolveNativeHover, preferences.sidebarSide, dockHeight, scale]);
  useEffect(() => {
    // A native resize can finish while the pointer is still moving. Resolve the
    // latest sample once React has committed the matching footprint.
    if (nativePointer.current) trackNativePointer(nativePointer.current);
  }, [layoutRevision, trackNativePointer]);
  const refreshData = useCallback(async function refresh() {
    if (refreshPending.current) { refreshAgain.current = true; return; }
    refreshPending.current = true;
    await Promise.all([
      getAccountUsage().then(value => { setAccount(value); setAccountStatus("ok"); }).catch(() => setAccountStatus("unavailable")),
      getDeepSeekUsage().then(setDeepseek).catch(() => setDeepseek(value => ({ ...value, status: value.updatedAt ? "stale" : "unavailable" }))),
    ]);
    refreshPending.current = false;
    if (refreshAgain.current) { refreshAgain.current = false; void refresh(); }
  }, []);
  useEffect(() => { setOpacity(preferences.sidebarOpacity ?? 0.9); }, [preferences.sidebarOpacity]);
  useEffect(() => { setScaleChoice(preferences.sidebarScale ?? 1); }, [preferences.sidebarScale]);
  useEffect(() => {
    let stopped = false;
    const syncViewport = () => {
      // Phase transitions synchronize their own viewport. A work-area or
      // preference resize also needs the native effective scale before hit tests.
      if (stopped) return;
      if (pendingPhase.current || viewportSyncPending.current) { viewportNeedsSync.current = true; return; }
      viewportNeedsSync.current = false;
      viewportSyncPending.current = true;
      const next = phaseRef.current;
      resizing.current = true;
      resizeNativeMovement.current = nativeMovement.current;
      void setSidebarPhase(next).then(viewport => {
        if (stopped || phaseRef.current !== next || pendingPhase.current) return;
        nativePhase.current = next;
        const requested = preferences.sidebarScale ?? 1;
        const effective = viewport?.scale ?? requested;
        setScale(effective);
        // Only a confirmed work-area limit adds a row. A pending size change
        // must not insert/remove this message and shift the settings controls.
        setScaleLimited(effective < requested - .015);
        reportedRegions.current = "";
        setLayoutRevision(value => value + 1);
      }).catch(() => { if (!stopped) setError(zh ? "侧边窗口调整失败。" : "Sidebar resize failed."); })
        .finally(() => {
          viewportSyncPending.current = false;
          if (!stopped && !pendingPhase.current) resizing.current = false;
          // Use the latest effect's preference snapshot after a resize burst.
          if (viewportNeedsSync.current) synchronizeViewport.current();
        });
    };
    synchronizeViewport.current = syncViewport;
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => { stopped = true; window.removeEventListener("resize", syncViewport); };
  }, [preferences.sidebarSide, preferences.sidebarScale, zh]);
  useEffect(() => {
    void refreshData();
    let stopped = false; const cleanups: (() => void)[] = [];
    for (const promise of [listenSidebarRecovery(() => {
      reportedRegions.current = "";
      changePhase("rail");
      setLayoutRevision(value => value + 1);
    }), listenSidebarDismiss(dismissMenu), listenSidebarPointer(trackNativePointer), listenDeepSeekReady(() => void refreshData())]) {
      void promise.then(fn => { if (stopped) fn(); else cleanups.push(fn); }).catch(() => setError(zh ? "事件监听失败，请重新打开应用。" : "Event listener failed. Reopen the app."));
    }
    const refreshTimer = window.setInterval(() => void refreshData(), 300_000);
    const clockTimer = window.setInterval(() => setNow(new Date()), 30_000);
    const blur = () => { focused.current = false; if (phaseRef.current === "menu") dismissMenu(); else { scheduleDetailCollapse(); scheduleCollapse(); } };
    const keyboard = () => { keyboardInput.current = true; };
    window.addEventListener("keydown", keyboard, true);
    window.addEventListener("blur", blur);
    return () => { stopped = true; cleanups.forEach(fn => fn()); cancelCollapse(); window.clearInterval(refreshTimer); window.clearInterval(clockTimer); window.removeEventListener("blur", blur); window.removeEventListener("keydown", keyboard, true); };
  }, [refreshData, changePhase, dismissMenu, trackNativePointer, cancelCollapse, scheduleCollapse, scheduleDetailCollapse, zh]);
  useEffect(() => {
    if (preferences.stayExpanded && phaseRef.current === "handle") changePhase("rail");
    if (!preferences.stayExpanded) scheduleCollapse();
  }, [preferences.stayExpanded, changePhase, scheduleCollapse]);
  const update = (patch: Partial<WidgetPreferences>) => onPreferences({ ...preferences, ...patch });
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try { await action(); } catch { setError(words("操作失败，请稍后重试。", "Operation failed. Please try again.")); }
  };
  const menu = () => {
    changePhase("menu");
    void getAutostart().then(setAutostart).catch(() => setAutostart(null));
  };
  const quotaWindows = sidebarQuotaWindows(snapshot);
  const quota = snapshot.status === "ok" || snapshot.status === "stale" ? quotaWindows[0]?.value : null;
  const quotaPercent = quota && Number.isFinite(quota.remainingPercent) ? Math.min(100, Math.max(0, quota.remainingPercent)) : null;
  const remaining = remainingFunds(deepseek);
  const ring = (id: "codex" | "deepseek", percent: number | null, stale: boolean) => <button type="button" className={`sidebar-provider sidebar-provider--${id}`} aria-label={`${id === "codex" ? "Codex" : "DeepSeek"} ${words("剩余", "remaining")} ${percent === null ? "—" : `${Math.round(percent)}%`}${stale ? words("，数据未更新", ", stale") : ""}`} aria-expanded={phase === "detail" && provider === id}
    data-sidebar-hover={id} data-native-hover={nativeTarget === id}
    onMouseEnter={event => showDetail(id, event)} onMouseMove={event => showDetail(id, event)} onClick={() => showDetail(id)}>
    <span className="sidebar-ring"><svg viewBox="0 0 44 44" aria-hidden="true"><circle className="sidebar-ring-track" cx="22" cy="22" r="19" /><circle className="sidebar-ring-value" cx="22" cy="22" r="19" pathLength="100" strokeDasharray={`${percent ?? 0} 100`} /></svg><img src={id === "codex" ? codexLogo : deepSeekLogo} alt="" /></span>
    <strong>{percent === null ? "—" : `${Math.round(percent)}%`}{stale ? "*" : ""}</strong><small>{words("剩余", "left")}</small>
  </button>;
  const days = account ? accountDays(account, now) : [];
  const money = (value: number | null) => formatMoney(value, preferences.language, deepseek.currency);
  const style = { "--sidebar-opacity": opacity, "--sidebar-scale": scale, "--sidebar-exit": `${EXIT_MS}ms`, "--sidebar-dock-height": `${dockHeight}px` } as CSSProperties;
  const sideName = { right: words("右侧", "right"), left: words("左侧", "left"), top: words("顶部", "top") };
  const directionLabel = words(`贴靠${sideName[side]}，切换到${sideName[nextSide]}`, `Docked ${sideName[side]}, switch to ${sideName[nextSide]}`);

  return <main ref={root} className={`sidebar sidebar--theme-${theme} sidebar--${preferences.sidebarSide ?? "right"} sidebar--${phase}`} data-glass={glassStatus} style={style} aria-label={words("侧边栏", "Sidebar")}
    onMouseEnter={event => { pointerPosition.current = { x: event.screenX, y: event.screenY }; if (nativeTracking.current) return; inside.current = true; cancelCollapse(); if (phaseRef.current === "handle") changePhase("rail"); }}
    onMouseMoveCapture={event => {
      pointerPosition.current = { x: event.screenX, y: event.screenY };
      if (nativeTracking.current) return;
      if (phaseRef.current === "handle") { inside.current = true; changePhase("rail"); }
      if ((!resizing.current || (pendingPhase.current === "rail" && motionTimer.current !== null))
        && (resizePointer.current?.x !== event.screenX || resizePointer.current?.y !== event.screenY)) trackDetailHover(event.target as Element, { x: event.clientX, y: event.clientY });
    }}
    onMouseLeave={() => { if (!nativeTracking.current) { inside.current = false; trackDetailHover(null); scheduleCollapse(); } }}
    onPointerDownCapture={event => {
      pointerPosition.current = { x: event.screenX, y: event.screenY };
      if (phaseRef.current === "menu" && !(event.target as Element).closest(".sidebar-menu, .sidebar-action")) {
        event.preventDefault(); event.stopPropagation(); dismissMenu();
      }
    }}
    onPointerDown={() => { keyboardInput.current = false; focused.current = false; }}
    onFocus={() => { focused.current = keyboardInput.current; cancelCollapse(); if (focused.current) cancelDetailCollapse(); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { focused.current = false; scheduleDetailCollapse(); scheduleCollapse(); } }}
    onContextMenu={event => { event.preventDefault(); menu(); }}
    onKeyDown={event => {
      keyboardInput.current = true;
      focused.current = event.currentTarget.contains(document.activeElement);
      if (event.key === "Escape") { event.stopPropagation(); if (phaseRef.current === "menu") { dismissMenu(); return; } (document.activeElement as HTMLElement)?.blur(); focused.current = false; changePhase("rail"); scheduleCollapse(); }
      if (event.key === "Tab" && phase === "menu") {
        const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')].filter(element => !element.closest("[inert]"));
        const first = elements[0]; const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <button className="sidebar-handle" aria-label={words("展开侧边栏", "Expand sidebar")} aria-hidden={phase !== "handle"} disabled={phase !== "handle"} onClick={() => changePhase("rail")} onFocus={() => changePhase("rail")} />
      <div className={`sidebar-dock${providerCount === 0 ? " sidebar-dock--empty" : ""}`} aria-hidden={phase === "handle"} inert={phase === "handle"}>
        <svg className="sidebar-silhouette" viewBox={side === "top" ? `-30 0 ${dockHeight + 60} 60` : `0 -30 60 ${dockHeight + 60}`} aria-hidden="true">
          <path transform={side === "top" ? "matrix(0 -1 1 0 0 60)" : undefined} d={`M 60 -30 A 30 30 0 0 1 30 0 H 28 A 28 28 0 0 0 0 28 V ${dockHeight - 28} A 28 28 0 0 0 28 ${dockHeight} H 30 A 30 30 0 0 1 60 ${dockHeight + 30} Z`} />
        </svg>
        <button className="sidebar-action sidebar-direction" data-sidebar-hover="direction" data-native-hover={nativeTarget === "direction"}
          aria-label={directionLabel} title={directionLabel} onClick={() => { setNativeTarget(null); update({ sidebarSide: nextSide }); }}>
          <ActionArc>{side === "right" ? <ArrowRight size={21} /> : side === "left" ? <ArrowLeft size={21} /> : <ArrowUp size={21} />}</ActionArc>
        </button>
      <div className="sidebar-rail">
        {showCodex && ring("codex", quotaPercent, snapshot.status === "stale")}
        {showDeepseek && ring("deepseek", remaining, deepseek.status === "stale")}
      </div>
        <button className="sidebar-action sidebar-gear" data-sidebar-hover="gear" data-native-hover={nativeTarget === "gear"} aria-label={words("侧边栏菜单", "Sidebar menu")} aria-expanded={phase === "menu"} onClick={() => phaseRef.current === "menu" ? changePhase("rail") : menu()}>
          <ActionArc><GearSix size={21} /></ActionArc>
        </button>
      </div>
      {panelPhase === "menu" ? <section ref={panel} className="sidebar-panel sidebar-menu" data-visible={phase === "menu"} aria-hidden={phase !== "menu"} inert={phase !== "menu"} role="dialog" aria-label={words("侧边栏菜单", "Sidebar menu")}>
        <header><h2>{words("设置", "Settings")}</h2><button aria-label={words("关闭菜单", "Close menu")} onClick={dismissMenu}><X size={17} /></button></header>
        <label>{words("展示模式", "Display mode")}<select value="sidebar" onChange={event => update({ displayMode: event.target.value as "floating" | "sidebar" })}><option value="floating">{words("悬浮窗", "Floating widget")}</option><option value="sidebar">{words("侧边栏", "Sidebar")}</option></select></label>
        <label>{words("贴边位置", "Screen edge")}<select value={side} onChange={event => update({ sidebarSide: event.target.value as WidgetPreferences["sidebarSide"] })}><option value="right">{words("右侧", "Right")}</option><option value="left">{words("左侧", "Left")}</option><option value="top">{words("顶部", "Top")}</option></select></label>
        <label className="sidebar-opacity">{words("侧边栏大小", "Sidebar size")}<output>{Math.round(scaleChoice * 100)}%</output><input aria-label={words("侧边栏大小", "Sidebar size")} type="range" min="80" max="130" step="10" value={Math.round(scaleChoice * 100)} onChange={event => { const value = Number(event.target.value) / 100; setScaleChoice(value); update({ sidebarScale: value }); }} /></label>
        {scaleLimited && <small className="sidebar-scale-note">{words("已缩小以适应当前屏幕", "Reduced to fit the current screen")}</small>}
        <fieldset className="sidebar-services"><legend>{words("显示服务", "Visible services")}</legend>
          <label>Codex<input type="checkbox" role="switch" aria-label={words("显示 Codex", "Show Codex")} checked={showCodex} onChange={event => update({ sidebarShowCodex: event.target.checked })} /></label>
          <label>DeepSeek<input type="checkbox" role="switch" aria-label={words("显示 DeepSeek", "Show DeepSeek")} checked={showDeepseek} onChange={event => update({ sidebarShowDeepseek: event.target.checked })} /></label>
        </fieldset>
        <label className="sidebar-opacity">{words("背景不透明度", "Background opacity")}<output>{Math.round(opacity * 100)}%</output><input aria-label={words("背景不透明度", "Background opacity")} type="range" min="20" max="100" value={Math.round(opacity * 100)} onChange={event => setOpacity(Number(event.target.value) / 100)} onPointerUp={() => update({ sidebarOpacity: opacity })} onKeyUp={() => update({ sidebarOpacity: opacity })} onBlur={() => { if (opacity !== preferences.sidebarOpacity) update({ sidebarOpacity: opacity }); }} /></label>
        <label>{words("毛玻璃效果", "Frosted glass")}<input type="checkbox" role="switch" aria-label={words("毛玻璃效果", "Frosted glass")} checked={preferences.sidebarGlassEnabled !== false} onChange={event => update({ sidebarGlassEnabled: event.target.checked })} /></label>
        {(glassStatus === "reducedTransparency" || glassStatus === "unavailable") && <small className="sidebar-glass-note">{glassStatus === "reducedTransparency" ? words("系统已减少透明度，当前使用实色背景。", "System transparency is reduced; using a solid background.") : words("毛玻璃暂不可用，当前使用实色背景。", "Frosted glass is unavailable; using a solid background.")}</small>}
        <label><span>{words("保持侧边栏展开", "Keep sidebar expanded")}</span><input type="checkbox" checked={preferences.stayExpanded} onChange={event => update({ stayExpanded: event.target.checked })} /></label>
        <label><span>{words("窗口置顶", "Always on top")}</span><input type="checkbox" checked={preferences.alwaysOnTop} onChange={event => { const checked = event.target.checked; void run(async () => onPreferences(await setAlwaysOnTop(checked))); }} /></label>
        <label>{words("语言", "Language")}<select value={preferences.language} onChange={event => update({ language: event.target.value as "zh-CN" | "en" })}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
        <label>{words("悬浮窗皮肤", "Floating skin")}<select value={preferences.selectedSkin} onChange={event => update({ selectedSkin: event.target.value as WidgetPreferences["selectedSkin"] })}><option value="default">Default</option><option value="blur">Blur</option><option value="computer">Computer</option></select></label>
        <label>{words("外观", "Appearance")}<select value={preferences.appearance} onChange={event => update({ appearance: event.target.value as WidgetPreferences["appearance"] })}><option value="system">{words("跟随系统", "System")}</option><option value="dark">{words("深色", "Dark")}</option><option value="light">{words("浅色", "Light")}</option></select></label>
        <button onClick={() => { onRefresh(); void refreshData(); }}><ArrowClockwise />{words("立即刷新", "Refresh now")}</button>
        <button onClick={() => void run(async () => setAutostart(await sidebarAction("autostart")))}>{words("开机启动", "Start at login")}<span>{autostart === null ? "—" : autostart ? words("已开启", "On") : words("已关闭", "Off")}</span></button>
        <button onClick={() => void run(() => deepSeekSession("open"))}>{words("登录 / 管理 DeepSeek", "Sign in / manage DeepSeek")}</button>
        {preferences.deepseekEnabled && <button onClick={() => void run(async () => { await deepSeekSession("disconnect"); setDeepseek(EMPTY_DEEPSEEK); })}>{words("退出 DeepSeek 登录", "Sign out of DeepSeek")}</button>}
        <button onClick={() => void run(() => sidebarAction("releases"))}>{words("打开版本下载页", "Release downloads")}</button>
        <button className="sidebar-quit" onClick={() => void run(() => sidebarAction("quit"))}>{words("退出 Codex Monitor", "Quit Codex Monitor")}</button>
      </section> : panelPhase === "detail" ? <section ref={panel} className={`sidebar-panel sidebar-detail sidebar-detail--${provider}`} data-visible={phase === "detail"} data-parked={phase !== "detail" && nativePhase.current !== "detail"} aria-hidden={phase !== "detail"} inert={phase !== "detail"} aria-label={provider === "codex" ? words("Codex 用量详情", "Codex usage details") : words("DeepSeek 用量详情", "DeepSeek usage details")}>
        <div className="sidebar-detail-content">
        <header><div className="sidebar-detail-title"><img src={provider === "codex" ? codexLogo : deepSeekLogo} alt="" /><div><h2>{provider === "codex" ? "Codex" : "DeepSeek"} {words("用量", "usage")}</h2><small>{provider === "codex" ? snapshot.plan ?? "—" : words("开放平台账户", "Platform account")}</small></div></div><button aria-label={words("保持侧边栏展开", "Keep sidebar expanded")} title={words("保持侧边栏展开", "Keep sidebar expanded")} aria-pressed={preferences.stayExpanded} onClick={() => update({ stayExpanded: !preferences.stayExpanded })}><PushPin weight={preferences.stayExpanded ? "fill" : "regular"} size={16} /></button></header>
        {provider === "codex" ? <>
          {snapshot.status !== "ok" && <p className="sidebar-status">{snapshot.status === "stale" ? words("额度数据未更新", "Quota data is stale") : words("额度暂不可用，请检查 Codex 登录", "Quota unavailable. Check Codex sign-in.")}</p>}
          {quotaWindows.length === 0 && <p className="sidebar-status">{words("额度暂不可用", "Quota unavailable")}</p>}
          {quotaWindows.map(row => { const name = row.kind === "short" ? words("5 小时额度", "5-hour quota") : words("每周额度", "Weekly quota"); return <div className="sidebar-quota" key={row.kind}><div><span>{name}</span><span>{formatResetTime(row.value.resetsAt, now, preferences.language)}</span></div><progress max={100} value={row.value.remainingPercent} aria-label={`${name} ${words("剩余", "remaining")}`} /><small>{row.value.remainingPercent.toFixed(1)}% {words("剩余", "remaining")}</small></div>; })}
          <dl><Metric label={words("未使用重置", "Unused resets")} value={snapshot.resetCredits ?? "—"} />{snapshot.resetCreditExpiresAt?.[0] && <Metric label={words("下次到期", "Next expiration")} value={formatDateTime(snapshot.resetCreditExpiresAt[0], preferences.language)} />}</dl>
          <h3 className="sr-only">{words("账户统计", "Account statistics")}</h3>
          {accountStatus !== "ok" && <p className="sidebar-status">{accountStatus === "loading" ? words("正在读取…", "Loading…") : account ? words("账户统计未更新", "Account statistics are stale") : words("账户统计暂不可用", "Account statistics unavailable")}</p>}
          <dl><TokenMetric label={words("累计 Token", "Lifetime tokens")} value={account?.lifetimeTokens} /><TokenMetric label={words("单日峰值", "Peak daily tokens")} value={account?.peakDailyTokens} /><Metric label={words("最长对话", "Longest chat")} value={durationText(account?.longestRunningTurnSeconds)} /><Metric label={words("当前连续", "Current streak")} value={account?.currentStreakDays == null ? "—" : `${account.currentStreakDays}d`} /><Metric label={words("最长连续", "Longest streak")} value={account?.longestStreakDays == null ? "—" : `${account.longestStreakDays}d`} /><Metric label={words("今日", "Today")} value={days.length && days.at(-1)?.tokens != null ? formatTokenCount(days.at(-1)?.tokens) : words("待出", "Pending")} /><TokenMetric label={words("近 30 个自然日", "Last 30 calendar days")} value={days.some(day => day.tokens !== null) ? sumTokens(days.map(day => day.tokens)) : null} /></dl>
          {account && <Chart label={words("每日 Token · 账户", "Daily tokens · Account")} days={days.map(day => ({ date: day.date, value: day.tokens }))} />}
        </> : <>
          {deepseek.status !== "ok" && <p className="sidebar-status">{deepseek.status === "signed_out" ? words("请先登录 DeepSeek 开放平台", "Sign in to DeepSeek Platform") : deepseek.status === "loading" ? words("正在读取…", "Loading…") : words("数据未更新，请刷新或重新登录", "Data unavailable or stale. Refresh or sign in again.")}</p>}
          {deepseek.status === "signed_out" && <button className="sidebar-connect" onClick={() => void run(() => deepSeekSession("open"))}>{words("登录 DeepSeek", "Sign in to DeepSeek")}</button>}
          <div className="sidebar-quota sidebar-quota--deepseek"><div><span>{words("账户资金", "Account funds")} ({deepseek.currency})</span><span>{remaining === null ? "—" : `${remaining.toFixed(1)}%`} {words("剩余", "remaining")}</span></div><progress max={100} value={remaining ?? 0} aria-label={words("账户资金剩余", "Funds remaining")} /></div>
          <dl className="sidebar-funds"><Metric label={words("累计已用", "Lifetime spend")} value={money(deepseek.spent)} /><Metric label={words("剩余余额", "Balance")} value={money(deepseek.balance)} /><Metric label={words("已用＋余额", "Spent + balance")} value={money(deepseek.spent === null || deepseek.balance === null ? null : deepseek.spent + deepseek.balance)} /></dl>
          <h3>{words("近 30 日用量明细", "Last 30 days")}<small>UTC{deepseek.timeZoneSeconds >= 0 ? "+" : ""}{deepseek.timeZoneSeconds / 3600}</small></h3>
          <dl className="sidebar-period"><TokenMetric label="Token" value={deepseek.tokens} /><Metric label={words("费用", "Cost")} value={money(deepseek.cost)} /><TokenMetric label={words("请求", "Requests")} value={deepseek.requests} /><Metric label={words("API 密钥数", "API keys")} value={deepseek.apiKeys ?? "—"} /></dl>
          <Chart label={words("每日 Token", "Daily tokens")} days={deepseek.daily.map(day => ({ date: day.date, value: day.tokens }))} />
          <Chart label={words("每日费用", "Daily cost")} money locale={preferences.language} currency={deepseek.currency} days={deepseek.daily.map(day => ({ date: day.date, value: String(Math.round(day.cost * 1000000)) }))} />
          <small className="sidebar-source">{words("实际扣费与计价时段以平台为准", "Platform charges and pricing periods prevail")}</small>
        </>}
        </div>
      </section> : null}
    {(error || notice) && <div className="sidebar-error" role="alert">{error || notice}</div>}
  </main>;
}
