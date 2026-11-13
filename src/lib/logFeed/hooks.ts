'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { logStore, type ArchiveSlice, type LiveSlice, type Slice } from './store';
import { createArchiveLoader, type ArchiveLoader } from './archiveLoader';
import { startLiveFeed } from './liveFeed';

function useSlice<T>(slice: Slice<T>, serverSnapshot: T, enabled: boolean): T {
  const current = useSyncExternalStore(slice.subscribe, slice.get, () => serverSnapshot);
  // While the mock-data tool is on, the feed is showing fixtures: hand back the
  // deterministic empty slice so nothing from the real transport can leak in.
  return enabled ? current : serverSnapshot;
}

const SERVER_LIVE: LiveSlice = { entries: [], status: 'idle', received: 0 };
const SERVER_ARCHIVE: ArchiveSlice = {
  entries: [],
  cursor: null,
  hasMore: true,
  status: 'idle',
  error: null,
  loadedOnce: false,
};

/** A loader that does nothing, used while mock data is on. */
const IDLE_LOADER: ArchiveLoader = {
  loadMore: () => Promise.resolve(),
  abort: () => {},
  reset: () => {},
};

export const useLiveSlice = (enabled = true) =>
  useSlice(logStore.live, SERVER_LIVE, enabled);
export const useArchiveSlice = (enabled = true) =>
  useSlice(logStore.archive, SERVER_ARCHIVE, enabled);

/**
 * Opens the real-time stream for the lifetime of the component.
 *
 * Pass `enabled = false` while the mock-data tool is showing fixtures: the
 * EventSource is never created, and stopping it steps the slice back to `idle`.
 */
export function useLiveFeed(kioskId: string, enabled = true) {
  useEffect(() => {
    if (!kioskId || !enabled) return;
    return startLiveFeed({ kioskId });
  }, [kioskId, enabled]);
}

/**
 * Owns an archive loader, loads the first page on mount and cancels on unmount.
 *
 * Pass `enabled = false` while the mock-data tool is showing fixtures: nothing is
 * fetched, and the returned loader is a no-op so "Try again" / "Load more" cannot
 * start a request either.
 */
export function useArchiveLoader(kioskId: string, enabled = true): ArchiveLoader {
  const [loader] = useState(() => createArchiveLoader({ kioskId }));

  useEffect(() => {
    if (!enabled) return;
    void loader.loadMore();
    return () => loader.abort();
  }, [loader, enabled]);

  return enabled ? loader : IDLE_LOADER;
}
