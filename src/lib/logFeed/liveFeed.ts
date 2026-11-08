/**
 * Real-time listener: subscribes to the server's Server-Sent Events stream and pushes
 * every heartbeat/log event into the `live` slice.
 *
 * Call it from an effect (browser only). It never awaits anything the archive loader
 * does, so older-page fetches cannot delay incoming events. EventSource reconnects by
 * itself after a network error; if the browser gives up (readyState CLOSED) we reopen
 * it with a short delay.
 *
 * Expected events on GET /api/kiosk/stream (JSON in `data`):
 *   event: heartbeat   data: {"kioskId":"KIOSK-001","timestamp":"..."}
 *   event: log         data: {"id":"...","kioskId":"...","meterVolume":12.5,"recordedAt":"..."}
 * Unnamed events (`message`) are accepted too and classified from their payload.
 */
import { logStore, type LogStore, type FeedKind } from './store';
import { normalizeEntry } from './normalize';

export const LIVE_STREAM_ENDPOINT = '/api/kiosk/stream';

export interface LiveFeedOptions {
  kioskId: string;
  url?: string;
  store?: LogStore;
  reconnectDelayMs?: number;
  /** Injectable for tests. */
  createSource?: (url: string) => EventSource;
}

const EVENT_SOURCE_CLOSED = 2;

export function startLiveFeed({
  kioskId,
  url = LIVE_STREAM_ENDPOINT,
  store = logStore,
  reconnectDelayMs = 3000,
  createSource = (target) => new EventSource(target),
}: LiveFeedOptions): () => void {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let hasConnectedBefore = false;

  const streamUrl = `${url}?${new URLSearchParams({ kioskId }).toString()}`;

  const handler = (fallbackKind?: FeedKind) => (event: MessageEvent) => {
    try {
      const entry = normalizeEntry(JSON.parse(String(event.data)), fallbackKind);
      if (entry) store.pushLive(entry);
    } catch {
      // A malformed event is skipped; it must not break the stream.
    }
  };

  const connect = () => {
    if (stopped) return;
    store.setLiveStatus(hasConnectedBefore ? 'reconnecting' : 'connecting');
    const current = createSource(streamUrl);
    source = current;

    current.onopen = () => {
      hasConnectedBefore = true;
      store.setLiveStatus('open');
    };
    current.addEventListener('heartbeat', handler('heartbeat') as EventListener);
    current.addEventListener('log', handler('log') as EventListener);
    current.addEventListener('message', handler() as EventListener);
    current.onerror = () => {
      if (stopped) return;
      store.setLiveStatus('reconnecting');
      if (current.readyState === EVENT_SOURCE_CLOSED) {
        current.close();
        timer = setTimeout(connect, reconnectDelayMs);
      }
    };
  };

  connect();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    source?.close();
    source = null;
    store.setLiveStatus('idle');
  };
}