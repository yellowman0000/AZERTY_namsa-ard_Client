'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { logStore, type ArchiveSlice, type LiveSlice, type Slice } from './store';
import { createArchiveLoader, type ArchiveLoader } from './archiveLoader';
import { startLiveFeed } from './liveFeed';

function useSlice<T>(slice: Slice<T>, serverSnapshot: T): T {
  return useSyncExternalStore(slice.subscribe, slice.get, () => serverSnapshot);
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

export const useLiveSlice = () => useSlice(logStore.live, SERVER_LIVE);
export const useArchiveSlice = () => useSlice(logStore.archive, SERVER_ARCHIVE);

/** Opens the real-time stream for the lifetime of the component. */
export function useLiveFeed(kioskId: string) {
  useEffect(() => {
    if (!kioskId) return;
    return startLiveFeed({ kioskId });
  }, [kioskId]);
}

/** Owns an archive loader, loads the first page on mount and cancels on unmount. */
export function useArchiveLoader(kioskId: string): ArchiveLoader {
  const [loader] = useState(() => createArchiveLoader({ kioskId }));

  useEffect(() => {
    void loader.loadMore();
    return () => loader.abort();
  }, [loader]);

  return loader;
}