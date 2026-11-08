/**
 * Log-feed state, split into two independent slices:
 *
 *  - `live`    : the rolling buffer of real-time heartbeat/log events.
 *  - `archive` : older entries fetched page by page (infinite scroll / page click).
 *
 * The slices never share state. An archive fetch (loading, failing, retrying,
 * being reset) only ever calls `archive.set(...)`, and a live event only ever calls
 * `live.set(...)`, so a slow or failing archive request cannot block, delay or drop
 * incoming real-time entries, and live traffic cannot re-render the archive list.
 *
 * Each slice is compatible with React's `useSyncExternalStore`
 * (same pattern as `connectionStatus` in ../http.ts). No extra dependency needed.
 */

export type FeedKind = 'heartbeat' | 'log';

export interface FeedEntry {
  id: string;
  kind: FeedKind;
  kioskId: string | null;
  /** ISO timestamp when the event happened. */
  timestamp: string;
  message: string;
  meterVolume: number | null;
}

export type LiveStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface LiveSlice {
  /** Newest first, capped at MAX_LIVE_ENTRIES. */
  entries: FeedEntry[];
  status: LiveStatus;
  /** Total events received since start (not capped). */
  received: number;
}

export type ArchiveStatus = 'idle' | 'loading' | 'error';

export interface ArchiveSlice {
  /** Newest first; each page is appended to the end. */
  entries: FeedEntry[];
  /** Cursor for the next page; null when there is nothing more (or nothing loaded yet). */
  cursor: string | null;
  hasMore: boolean;
  status: ArchiveStatus;
  error: string | null;
  /** True once at least one page request has succeeded. */
  loadedOnce: boolean;
}

export interface Slice<T> {
  get: () => T;
  set: (updater: (prev: T) => T) => void;
  subscribe: (listener: () => void) => () => void;
}

export const MAX_LIVE_ENTRIES = 200;

function createSlice<T>(initial: T): Slice<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (updater) => {
      const next = updater(state);
      if (next === state) return; // no-op updates don't notify
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const initialLive = (): LiveSlice => ({ entries: [], status: 'idle', received: 0 });
const initialArchive = (): ArchiveSlice => ({
  entries: [],
  cursor: null,
  hasMore: true,
  status: 'idle',
  error: null,
  loadedOnce: false,
});

export function createLogStore() {
  const live = createSlice<LiveSlice>(initialLive());
  const archive = createSlice<ArchiveSlice>(initialArchive());

  return {
    live,
    archive,

    /* ---- live slice: only ever touched by the real-time listener ---- */
    pushLive(entry: FeedEntry) {
      live.set((prev) => {
        // EventSource replays can re-deliver an event after a reconnect.
        if (prev.entries.some((existing) => existing.id === entry.id)) return prev;
        const entries = [entry, ...prev.entries];
        if (entries.length > MAX_LIVE_ENTRIES) entries.length = MAX_LIVE_ENTRIES;
        return { ...prev, entries, received: prev.received + 1 };
      });
    },
    setLiveStatus(status: LiveStatus) {
      live.set((prev) => (prev.status === status ? prev : { ...prev, status }));
    },

    /* ---- archive slice: only ever touched by the archive loader ---- */
    archiveStarted() {
      archive.set((prev) => ({ ...prev, status: 'loading', error: null }));
    },
    archiveSucceeded(entries: FeedEntry[], nextCursor: string | null) {
      archive.set((prev) => {
        const seen = new Set(prev.entries.map((entry) => entry.id));
        const fresh = entries.filter((entry) => {
          if (seen.has(entry.id)) return false;
          seen.add(entry.id);
          return true;
        });
        return {
          entries: fresh.length ? [...prev.entries, ...fresh] : prev.entries,
          cursor: nextCursor,
          hasMore: nextCursor !== null,
          status: 'idle',
          error: null,
          loadedOnce: true,
        };
      });
    },
    archiveFailed(message: string) {
      // Keep the entries and cursor so a retry continues where it stopped.
      archive.set((prev) => ({ ...prev, status: 'error', error: message }));
    },
    archiveAborted() {
      archive.set((prev) => (prev.status === 'loading' ? { ...prev, status: 'idle' } : prev));
    },
    resetArchive() {
      archive.set(() => initialArchive());
    },
  };
}

export type LogStore = ReturnType<typeof createLogStore>;

/** App-wide store. Tests create their own with createLogStore(). */
export const logStore: LogStore = createLogStore();