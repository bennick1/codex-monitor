import { getTokenStatistics, listenTokenStatisticsUpdated, refreshTokenStatistics } from "./bridge";
import type { TokenStatisticsNotification, TokenStatisticsSnapshot } from "./tokenStatistics";

export interface TokenStatisticsView {
  snapshot: TokenStatisticsSnapshot | null;
  loading: boolean;
  failed: boolean;
  listenerFailed: boolean;
}
export const INITIAL_TOKEN_VIEW: TokenStatisticsView = { snapshot: null, loading: true, failed: false, listenerFailed: false };
export const TOKEN_POLL_MS = 60_000;
const EVENT_COALESCE_MS = 500;

/** One owner for IPC, including requests surviving StrictMode effect cleanup. */
export class TokenStatisticsController {
  private view = INITIAL_TOKEN_VIEW;
  private publish: ((view: TokenStatisticsView) => void) | null = null;
  private epoch = 0;
  private revision = 0;
  private source: string | null | undefined;
  private expanded = false;
  private registered = false;
  private pending = false;
  private inFlight = false;
  private refreshing = false;
  private eventTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private unlisten: (() => void) | undefined;

  private update(patch: Partial<TokenStatisticsView>) {
    this.view = { ...this.view, ...patch };
    this.publish?.(this.view);
  }

  start(publish: (view: TokenStatisticsView) => void) {
    const epoch = ++this.epoch;
    this.publish = publish;
    publish(this.view);
    // Subscribe first: events arriving during registration mark a trailing read.
    void listenTokenStatisticsUpdated((event) => {
      if (epoch === this.epoch && this.publish) this.onEvent(event);
    }).then((unlisten) => {
      if (epoch !== this.epoch || !this.publish) { unlisten(); return; }
      this.unlisten = unlisten;
      this.update({ listenerFailed: false });
    }).catch(() => {
      if (epoch === this.epoch && this.publish) this.update({ listenerFailed: true });
    }).finally(() => {
      if (epoch !== this.epoch || !this.publish) return;
      this.registered = true;
      this.request();
    });
    return () => {
      ++this.epoch;
      this.publish = null;
      this.registered = false;
      this.pending = false;
      this.unlisten?.();
      this.unlisten = undefined;
      clearTimeout(this.eventTimer);
      clearInterval(this.pollTimer);
      this.eventTimer = undefined;
      this.pollTimer = undefined;
    };
  }

  setExpanded(expanded: boolean) {
    this.expanded = expanded;
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    if (expanded) {
      this.request();
      // Calendar membership is backend-owned; do not compare only generation.
      this.pollTimer = setInterval(() => this.request(), TOKEN_POLL_MS);
    } else {
      clearTimeout(this.eventTimer);
      this.eventTimer = undefined;
      this.pending = false;
    }
  }

  private onEvent(event: TokenStatisticsNotification) {
    ++this.revision;
    this.source = event.sourceId;
    if (this.view.snapshot && this.view.snapshot.sourceId !== event.sourceId) {
      this.update({ snapshot: null, loading: true, failed: false });
    }
    if (this.expanded) this.schedule();
    // Closed panels consume no display queries; every open requests current Q.
  }

  private schedule() {
    this.pending = true;
    if (this.eventTimer !== undefined || this.inFlight) return;
    this.eventTimer = setTimeout(() => {
      this.eventTimer = undefined;
      this.request();
    }, EVENT_COALESCE_MS);
  }

  private request() {
    this.pending = true;
    if (!this.publish || !this.registered || this.inFlight) return;
    clearTimeout(this.eventTimer);
    this.eventTimer = undefined;
    this.pending = false;
    this.inFlight = true;
    const epoch = this.epoch;
    const revision = this.revision;
    this.update({ loading: true });
    void getTokenStatistics().then((snapshot) => {
      if (epoch !== this.epoch || !this.publish) return;
      // An event may name a new source while this read still owns an old root.
      if (revision !== this.revision && this.source !== snapshot.sourceId) return;
      const previous = this.view.snapshot;
      if (previous?.sourceId === snapshot.sourceId && BigInt(snapshot.generation) < BigInt(previous.generation)) return;
      this.source = snapshot.sourceId;
      // Replace one coherent response, never fill nulls from a different Q/root.
      this.update({ snapshot, failed: false });
    }).catch(() => {
      if (epoch === this.epoch && this.publish) this.update({ failed: true });
    }).finally(() => {
      this.inFlight = false;
      if (!this.publish) return;
      if (epoch === this.epoch) this.update({ loading: false });
      if (this.pending) this.schedule();
    });
  }

  /** Explicit user refresh only; quota runs independently in App. */
  readonly refresh = async () => {
    if (this.refreshing) return;
    this.refreshing = true;
    const epoch = this.epoch;
    try {
      await refreshTokenStatistics();
      if (epoch === this.epoch && this.publish) this.request();
    } catch {
      if (epoch === this.epoch && this.publish) this.update({ failed: true });
    } finally {
      this.refreshing = false;
    }
  };
}
