export type ProviderId = "codex" | "claude";
export type SnapshotStatus = "ok" | "stale" | "loading" | "unavailable" | "signed_out";
export type Language = "zh-CN" | "en";
export type WidgetTheme = "light" | "dark";
export type AppearancePreference = "system" | WidgetTheme;
export type WidgetSkin = "default" | "blur" | "computer" | "mecha-light";
export type MenubarQuotaDisplay = "short" | "weekly" | "both";
export interface UsageWindow {
  remainingPercent: number;
  resetsAt: string | null;
  windowSeconds: number;
}

export interface ProviderSnapshot {
  /** Opaque process-local account revision; never an account identifier. */
  accountGeneration?: number;
  provider: ProviderId;
  displayName: string;
  plan: string | null;
  shortWindow: UsageWindow | null;
  weeklyWindow: UsageWindow | null;
  resetCredits: number | null;
  resetCreditExpiresAt?: string[];
  updatedAt: string;
  status: SnapshotStatus;
  message: string | null;
}

export interface WidgetPreferences {
  autoCheckUpdates?: boolean;
  deepseekEnabled?: boolean;
  displayMode?: "floating" | "sidebar" | "menubar";
  menubarQuotaDisplay?: MenubarQuotaDisplay;
  /** Native-owned position for returning to the floating mode. */
  floatingPosition?: [number, number] | null;
  sidebarSide?: "left" | "right" | "top";
  sidebarOpacity?: number;
  sidebarGlassEnabled?: boolean;
  sidebarScale?: number;
  sidebarShowCodex?: boolean;
  sidebarShowDeepseek?: boolean;
  locked: boolean;
  alwaysOnTop: boolean;
  stayExpanded: boolean;
  pinnedProvider: ProviderId | null;
  autoRotateSeconds: number;
  language: Language;
  appearance: AppearancePreference;
  selectedSkin: WidgetSkin;
  opacityPercent: number;
}
