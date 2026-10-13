import { expandedHeightMode } from "./lib/widgetGeometry";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTokenStatistics } from "./hooks/useTokenStatistics";
import { useUpdater } from "./hooks/useUpdater";
import { openUpdateWindow } from "./lib/updater";
import { Sidebar } from "./components/Sidebar";
import { QuotaCard, QuotaOrb } from "./components/QuotaCard";
import { fetchSnapshots, getPreferences, isTauri, listenDesktopEvents, setAlwaysOnTop, setWidgetExpanded, startDragging, syncWidgetAppearance, updatePreferences } from "./lib/bridge";
import { needsFastRefresh, quotaTier } from "./lib/format";
import { openReleasePage } from "./lib/releasePage";
import { copy, normalizeLanguage } from "./lib/i18n";
import { mergeSnapshots } from "./lib/snapshots";
import { DESKTOP_PALETTES } from "./lib/desktopPalette";
import { DEFAULT_PREFERENCES as DEFAULT_PREFS, normalizePreferences } from "./lib/widgetPreferences";
import type { ProviderSnapshot, WidgetPreferences, WidgetSkin, WidgetTheme } from "./types";

const INITIAL_SNAPSHOT: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: null,
  shortWindow: null,
  weeklyWindow: null,
  resetCredits: null,
  resetCreditExpiresAt: [],
  updatedAt: new Date().toISOString(),
  status: "unavailable",
  message: "Quota is loading.",
};

export default function App() {
  const { state: updater } = useUpdater();
  const [snapshots, setSnapshots] = useState<ProviderSnapshot[]>([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFS);
  const confirmedPreferences = useRef(DEFAULT_PREFS);
  const preferenceSaveSequence = useRef(0);
  const preferenceSavePending = useRef(false);
  const preferenceEventVersion = useRef(0);
  const acceptPreferences = useCallback((value: WidgetPreferences) => {
    const normalized = normalizePreferences(value);
    confirmedPreferences.current = normalized;
    setPreferences(normalized);
  }, []);
  useLayoutEffect(() => {
    // Keep the existing host/main composition intact. Applying the single
    // opacity factor to the host also leaves each skin's child animation alone.
    const root = document.getElementById("root");
    if (!root || preferences.displayMode === "sidebar") return;
    const previousOpacity = root.style.opacity;
    const previousTransform = root.style.transform;
    const hadVisualRootClass = root.classList.contains("widget-visual-root");
    root.classList.add("widget-visual-root");
    root.style.opacity = String(preferences.opacityPercent / 100);
    // Rasterize the existing host as one surface before applying opacity.
    // This keeps fractional rounded edges on the same antialiasing path as
    // the undimmed widget; the identity transform leaves layout unchanged.
    if (preferences.opacityPercent < 100) root.style.transform = "translateZ(0)";
    return () => {
      root.style.opacity = previousOpacity;
      root.style.transform = previousTransform;
      if (!hadVisualRootClass) root.classList.remove("widget-visual-root");
    };
  }, [preferences.opacityPercent, preferences.displayMode]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [compact, setCompact] = useState(true);
  const previousMode = useRef(preferences.displayMode);
  const [consumingProviders, setConsumingProviders] = useState<Set<string>>(() => new Set());
  const [operationError, setOperationError] = useState<string | null>(null);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const current = preferences.pinnedProvider
    ? snapshots.find((item) => item.provider === preferences.pinnedProvider) ?? snapshots[0] ?? INITIAL_SNAPSHOT
    : snapshots[activeIndex % Math.max(1, snapshots.length)] ?? INITIAL_SNAPSHOT;
  const tokens = useTokenStatistics(preferences.displayMode !== "sidebar" && !compact, current);
  const failures = useRef(0);
  const previousPrimary = useRef(new Map<string, number>());
  const consumptionTimers = useRef(new Map<string, number>());
  const collapseTimer = useRef<number | null>(null);
  const hoverSequence = useRef(0);
  const menuOpen = useRef(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];
  const operation = language === "zh-CN" ? {
    listenerFailed: "桌面事件监听启动失败。",
    settingsFailed: "设置保存失败，已恢复之前的状态。",
    alwaysOnTopFailed: "置顶状态切换失败。",
    expandFailed: "组件展开失败。",
    collapseFailed: "组件收起失败。",
    releaseOpenFailed: "无法打开 GitHub Releases。",
  } : {
    listenerFailed: "Desktop event listener failed to start.",
    settingsFailed: "Settings could not be saved. Previous state restored.",
    alwaysOnTopFailed: "Always-on-top toggle failed.",
    expandFailed: "Widget expand failed.",
    collapseFailed: "Widget collapse failed.",
    releaseOpenFailed: "Could not open GitHub Releases.",
  };
  const theme: WidgetTheme = preferences.appearance === "system" ? (systemDark ? "dark" : "light") : preferences.appearance;
  const skin: WidgetSkin = preferences.selectedSkin;
  const heightMode = expandedHeightMode(current);
  useEffect(() => {
    if (preferences.displayMode === "sidebar") return;
    // This only reconciles the transparent-window safety inset after a theme
    // change. A platform refusal is non-fatal: the current widget geometry is
    // still usable and users should never see an internal resize error.
    void syncWidgetAppearance(theme, heightMode).catch(() => undefined);
  }, [theme, heightMode, preferences.displayMode]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => setSystemDark(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const refresh = useCallback(async (force = false) => {
    try {
      const values = await fetchSnapshots(force);
      const hasFailure = values.some((item) => item.status !== "ok");
      if (hasFailure) failures.current += 1;
      else failures.current = 0;
      for (const item of values) {
        const nextPrimary = item.shortWindow?.remainingPercent;
        const previous = previousPrimary.current.get(item.provider);
        if (nextPrimary !== undefined && previous !== undefined && nextPrimary < previous) {
          setConsumingProviders((current) => new Set(current).add(item.provider));
          const oldTimer = consumptionTimers.current.get(item.provider);
          if (oldTimer !== undefined) window.clearTimeout(oldTimer);
          const timer = window.setTimeout(() => {
            setConsumingProviders((current) => { const next = new Set(current); next.delete(item.provider); return next; });
            consumptionTimers.current.delete(item.provider);
          }, 5 * 60_000);
          consumptionTimers.current.set(item.provider, timer);
        }
        if (nextPrimary !== undefined) previousPrimary.current.set(item.provider, nextPrimary);
      }
      setSnapshots((current) => mergeSnapshots(current, values));
    } catch {
      failures.current += 1;
      setSnapshots((current) => current.length > 0
        ? current.map((item) => ({ ...item, status: "stale", message: "Refresh failed. Please try again later." }))
        : [{ provider: "codex", displayName: "CODEX", plan: null, shortWindow: null, weeklyWindow: null, resetCredits: null, resetCreditExpiresAt: [], updatedAt: new Date().toISOString(), status: "unavailable", message: "Quota is temporarily unavailable. It will retry automatically." }]);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const sequence = preferenceSaveSequence.current;
    void (async () => {
      const value = await getPreferences().catch(async () => {
        // A WebView can occasionally issue its first invoke while it is
        // resuming. Retry once, then retain the already-safe defaults without
        // showing a persistent warning on the quota card.
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        return getPreferences().catch(() => DEFAULT_PREFS);
      });
      if (sequence !== preferenceSaveSequence.current) return;
      acceptPreferences(value);
      // Window-state may restore the last expanded footprint while React starts
      // as an orb. Reconcile once, unless the user has already begun hovering.
      if (value.displayMode !== "sidebar" && !value.stayExpanded && hoverSequence.current === 0) {
        void setWidgetExpanded(false).catch(() => undefined);
      }
    })().catch(() => { if (sequence === preferenceSaveSequence.current) acceptPreferences(DEFAULT_PREFS); });
    return () => {
      for (const timer of consumptionTimers.current.values()) window.clearTimeout(timer);
      consumptionTimers.current.clear();
      if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    };
  }, [refresh, acceptPreferences]);

  const refreshAll = useCallback(() => {
    void refresh(true);
    void tokens.refresh();
  }, [refresh, tokens.refresh]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: () => void = () => {};
    void listenDesktopEvents({
      onPreferences: (value) => {
        preferenceEventVersion.current++;
        // Older save acknowledgements must not replace a newer local edit.
        // The final save reads back all preferences, including external changes.
        if (!preferenceSavePending.current) acceptPreferences(value);
      },
      onRefresh: refreshAll,
      onRelease: () => void openReleasePage().catch(() => setOperationError(operation.releaseOpenFailed)),
    }).then((value) => {
      if (cancelled) value(); else cleanup = value;
    }).catch(() => setOperationError(operation.listenerFailed));
    return () => { cancelled = true; cleanup(); };
  }, [operation.listenerFailed, operation.releaseOpenFailed, refreshAll, acceptPreferences]);

  const refreshMs = useMemo(() => {
    const backoff = failures.current === 0 ? 5 * 60_000 : Math.min(30 * 60_000, 30_000 * 2 ** (failures.current - 1));
    if (failures.current === 0 && snapshots.some((item) => item.status === "ok" && needsFastRefresh(item))) return 60_000;
    return backoff;
  }, [snapshots]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(id);
  }, [refresh, refreshMs]);

  useEffect(() => {
    const refreshWhenActive = () => { if (document.visibilityState === "visible") void refresh(true); };
    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [refresh]);

  useEffect(() => {
    if (hovered || preferences.pinnedProvider || snapshots.length < 2) return;
    const id = window.setInterval(() => setActiveIndex((value) => (value + 1) % snapshots.length), preferences.autoRotateSeconds * 1000);
    return () => window.clearInterval(id);
  }, [hovered, preferences.autoRotateSeconds, preferences.pinnedProvider, snapshots.length]);

  const primaryPercent = current?.shortWindow?.remainingPercent ?? current?.weeklyWindow?.remainingPercent ?? null;
  const tier = quotaTier(primaryPercent);
  const paletteName = current.status === "unavailable" || current.status === "stale" || current.status === "signed_out"
    ? current.status
    : tier === "healthy" || tier === "caution" || tier === "critical" ? tier : null;
  // The production widget and design workbench share one explicit palette
  // source. Theme records are independent so light and dark cannot leak into
  // one another through CSS defaults or preview state.
  const cardStyle = paletteName ? DESKTOP_PALETTES[theme][paletteName] : undefined;

  const savePreferences = useCallback((next: WidgetPreferences) => {
    const sequence = ++preferenceSaveSequence.current;
    preferenceSavePending.current = true;
    setPreferences(next);
    setOperationError(null);
    const reconcile = async (failed: boolean) => {
      if (sequence !== preferenceSaveSequence.current) return;
      let saved = failed ? confirmedPreferences.current : next;
      if (isTauri()) {
        // Re-read if an external preference event arrives while the read is in
        // flight. A newer local save owns its own reconciliation and rollback.
        let eventVersion: number;
        do {
          eventVersion = preferenceEventVersion.current;
          saved = await getPreferences().catch(() => saved);
          if (sequence !== preferenceSaveSequence.current) return;
        } while (eventVersion !== preferenceEventVersion.current);
      }
      acceptPreferences(saved);
      preferenceSavePending.current = false;
      if (failed) setOperationError(operation.settingsFailed);
    };
    void updatePreferences(next).then(() => {
      // Saves are serialized by the bridge, so this is a confirmed fallback
      // even if a later save fails and its reconciliation read is unavailable.
      confirmedPreferences.current = normalizePreferences(next);
      return reconcile(false);
    }, () => reconcile(true));
  }, [operation.settingsFailed, acceptPreferences]);

  const handleHover = useCallback((value: boolean) => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setHovered(value);
    if (!value && (preferences.stayExpanded || menuOpen.current)) return;
    if (value) void refresh(true);
    if (value) {
      const sequence = ++hoverSequence.current;
      void setWidgetExpanded(true)
        .then(() => { if (hoverSequence.current === sequence) setCompact(false); })
        .catch(() => {
          setCompact(false);
          setOperationError(operation.expandFailed);
        });
      return;
    }
    const sequence = ++hoverSequence.current;
    collapseTimer.current = window.setTimeout(() => {
      if (hoverSequence.current !== sequence) return;
      setCompact(true);
      void setWidgetExpanded(false).catch(() => setOperationError(operation.collapseFailed));
    }, 180);
  }, [operation.collapseFailed, operation.expandFailed, preferences.stayExpanded, refresh]);

  useEffect(() => {
    if (preferences.displayMode === "sidebar" || !preferences.stayExpanded) return;
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    setCompact(false);
    void setWidgetExpanded(true).catch(() => setOperationError(operation.expandFailed));
  }, [operation.expandFailed, preferences.stayExpanded, preferences.displayMode]);

  useEffect(() => {
    if (previousMode.current !== preferences.displayMode) {
      previousMode.current = preferences.displayMode;
      ++hoverSequence.current;
      if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
      if (preferences.displayMode !== "sidebar") {
        setCompact(!preferences.stayExpanded);
        void setWidgetExpanded(preferences.stayExpanded).catch(() => setOperationError(operation.expandFailed));
      }
    }
  }, [preferences.displayMode, preferences.stayExpanded, operation.expandFailed]);

  const showMenu = () => {
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    menuOpen.current = true;
    setModeMenuOpen(true);
  };
  const closeMenu = () => { menuOpen.current = false; setModeMenuOpen(false); };

  if (preferences.displayMode === "sidebar") {
    return <Sidebar snapshot={snapshots.find(value => value.provider === "codex") ?? INITIAL_SNAPSHOT}
      preferences={preferences} theme={theme} onPreferences={savePreferences} onRefresh={refreshAll}
      notice={operationError} />;
  }

  if (compact) {
    return <QuotaOrb snapshot={current} language={language} onDrag={() => startDragging()} onHover={handleHover} theme={theme} skin={skin} style={cardStyle} />;
  }

  return (
    <>
    {modeMenuOpen && <div className="display-mode-menu" role="dialog" aria-label={language === "zh-CN" ? "展示模式" : "Display mode"} onKeyDown={event => { if (event.key === "Escape") closeMenu(); }}>
      <strong>{language === "zh-CN" ? "展示模式" : "Display mode"}</strong>
      <button onClick={() => { closeMenu(); savePreferences({ ...preferences, displayMode: "sidebar" }); }}>{language === "zh-CN" ? "切换到侧边栏" : "Switch to sidebar"}</button>
      <button onClick={() => { void openUpdateWindow().catch(error => setOperationError(String(error))); }}>{language === "zh-CN" ? "检查更新" : "Check for updates"}{updater.version ? ` · ${updater.version}` : ""}</button>
      <label>{language === "zh-CN" ? "自动检查更新" : "Automatically check for updates"}<input type="checkbox" checked={preferences.autoCheckUpdates !== false} onChange={event => savePreferences({ ...preferences, autoCheckUpdates: event.target.checked })} /></label>
      <button onClick={() => void openReleasePage().catch(() => setOperationError(operation.releaseOpenFailed))}>{language === "zh-CN" ? "打开版本下载页" : "Release downloads"}</button>
      <button onClick={closeMenu}>{language === "zh-CN" ? "保留悬浮窗" : "Keep floating widget"}</button>
    </div>}
    <QuotaCard
      snapshot={current}
      preferences={preferences}
      providerCount={snapshots.length}
      onPrevious={() => setActiveIndex((value) => (value - 1 + snapshots.length) % snapshots.length)}
      onNext={() => setActiveIndex((value) => (value + 1) % snapshots.length)}
      onTogglePin={() => savePreferences({ ...preferences, pinnedProvider: preferences.pinnedProvider ? null : current.provider })}
      onToggleStayExpanded={() => savePreferences({ ...preferences, stayExpanded: !preferences.stayExpanded })}
      onLock={() => { setOperationError(null); void setAlwaysOnTop(!preferences.alwaysOnTop).then((value) => setPreferences(normalizePreferences(value))).catch(() => setOperationError(operation.alwaysOnTopFailed)); }}
      onDrag={() => startDragging()}
      onHover={handleHover}
      onRefresh={refreshAll}
      onMenu={showMenu}
      tokens={tokens}
      isConsuming={consumingProviders.has(current.provider)}
      theme={theme}
      skin={skin}
      style={cardStyle}
      notice={operationError}
    /></>
  );
}
