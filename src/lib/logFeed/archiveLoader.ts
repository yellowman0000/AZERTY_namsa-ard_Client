/**
 * Asynchronous archive fetcher (infinite scroll / "load more" page click).
 *
 * Non-blocking guarantees:
 *  - It only writes to the `archive` slice; live events keep flowing into the `live`
 *    slice while a page is loading, failing or being retried.
 *  - It uses fetchWithTimeout (single attempt, 8 s) instead of fetchWithRetry, so a
 *    flaky archive endpoint never runs a ~34 s backoff loop and never flips the
 *    shared `connectionStatus` to "dropped" (which would show "Connection lost"
 *    on the kiosk while heartbeats are actually fine).
 *  - One request in flight at a time; extra scroll events reuse it.
 *  - On failure the cursor is kept: `loadMore()` retries the same page.
 */
import { fetchWithTimeout } from '../http';
import { logStore, type LogStore } from './store';
import { parseArchivePage } from './normalize';

export const ARCHIVE_ENDPOINT = '/api/kiosk/logs/archive';
export const ARCHIVE_PAGE_SIZE = 20;
export const ARCHIVE_TIMEOUT_MS = 8000;

export interface ArchiveLoaderOptions {
  kioskId: string;
  store?: LogStore;
  endpoint?: string;
  pageSize?: number;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchFn?: typeof fetchWithTimeout;
}

export interface ArchiveLoader {
  /** Fetch the next page. Resolves when done; never rejects. */
  loadMore: () => Promise<void>;
  /** Cancel any in-flight request (e.g. on unmount). Keeps already loaded entries. */
  abort: () => void;
  /** Cancel and clear everything, so the next loadMore() starts from the first page. */
  reset: () => void;
}

export function createArchiveLoader({
  kioskId,
  store = logStore,
  endpoint = ARCHIVE_ENDPOINT,
  pageSize = ARCHIVE_PAGE_SIZE,
  timeoutMs = ARCHIVE_TIMEOUT_MS,
  fetchFn = fetchWithTimeout,
}: ArchiveLoaderOptions): ArchiveLoader {
  let inFlight: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let generation = 0; // bumped on abort/reset so late responses are ignored

  const buildUrl = (cursor: string | null) => {
    const params = new URLSearchParams({ kioskId, limit: String(pageSize) });
    if (cursor) params.set('cursor', cursor);
    return `${endpoint}?${params.toString()}`;
  };

  const loadMore = (): Promise<void> => {
    if (inFlight) return inFlight;
    const { hasMore, cursor } = store.archive.get();
    if (!hasMore) return Promise.resolve();

    const myGeneration = generation;
    const myController = new AbortController();
    controller = myController;
    store.archiveStarted();

    const request = (async () => {
      try {
        const res = await fetchFn(
          buildUrl(cursor),
          { headers: { Accept: 'application/json' }, cache: 'no-store', signal: myController.signal },
          timeoutMs
        );
        if (!res.ok) throw new Error(`Archive request failed (HTTP ${res.status}).`);
        const page = parseArchivePage(await res.json(), pageSize);
        if (myGeneration !== generation) return; // aborted or reset meanwhile
        store.archiveSucceeded(page.entries, page.nextCursor);
      } catch (error) {
        if (myGeneration !== generation) return;
        const message =
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Archive request timed out.'
            : error instanceof Error
              ? error.message
              : 'Could not load older entries.';
        store.archiveFailed(message);
      } finally {
        if (myGeneration === generation) {
          inFlight = null;
          controller = null;
        }
      }
    })();

    inFlight = request;
    return request;
  };

  const abort = () => {
    generation += 1;
    controller?.abort();
    controller = null;
    inFlight = null;
    store.archiveAborted();
  };

  const reset = () => {
    abort();
    store.resetArchive();
  };

  return { loadMore, abort, reset };
}