/**
 * Kiosk mock datasets.
 *
 * One dataset per data surface of the kiosk app: the live feed (rows + its chip
 * and session counter), the archive (rows + its loading/error/end state) and the
 * singleton kiosk status behind the header pill and the device details. Field
 * keys are the production field names (see `lib/logFeed/store.ts` — `FeedEntry`,
 * `LiveSlice`, `ArchiveSlice`), and the selectors in `selectors.ts` cast rows
 * back into those types, so the panel can never silently drift from what the
 * views expect.
 *
 * Seeds are plain functions of `now`: the store calls them from a click handler,
 * never during render, so the prerendered shell stays deterministic.
 */
import type { DatasetSchema, FieldSchema, FixtureRow } from './types';

/* ---------- small deterministic helpers ---------- */

const pad = (value: number) => String(value).padStart(2, '0');

/** Local `YYYY-MM-DDTHH:mm`, exactly what a `datetime-local` input round-trips. */
export function localStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** Local calendar day `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local wall-clock time `HH:mm:ss` — the shape the heartbeat shows after "at". */
export function localClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const minutesBefore = (now: Date, minutes: number): Date =>
  new Date(now.getTime() - minutes * 60_000);

const hoursBefore = (now: Date, hours: number): Date =>
  new Date(now.getTime() - hours * 3_600_000);

const KIOSK_ID = 'KIOSK-001';

const LIVE_COUNT = 12;
const ARCHIVE_COUNT = 9;

const LIVE_ID = (index: number) => `mock-live-${pad(index + 1)}`;
const ARCHIVE_ID = (index: number) => `mock-archive-${pad(index + 1)}`;

/** Same wording `normalizeEntry` synthesises when the server omits a message. */
const heartbeatMessage = () => `Heartbeat from ${KIOSK_ID}`;
const logMessage = (volume: number) => `Meter reading ${volume} L`;

/* ---------- field helpers ---------- */

const text = (key: string, label: string, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  key,
  label,
  type: 'text',
  width: 'half',
  ...extra,
});

const liters = (key: string, label: string): FieldSchema => ({
  key,
  label,
  type: 'number',
  width: 'half',
  step: 1,
  min: 0,
});

const count = (
  key: string,
  label: string,
  extra: Partial<FieldSchema> = {}
): FieldSchema => ({
  key,
  label,
  type: 'number',
  width: 'half',
  step: 1,
  min: 0,
  ...extra,
});

const when = (key: string, label: string): FieldSchema => ({
  key,
  label,
  type: 'datetime',
  width: 'half',
});

const flag = (key: string, label: string, help?: string): FieldSchema => ({
  key,
  label,
  type: 'boolean',
  width: 'half',
  ...(help ? { help } : {}),
});

const choice = (
  key: string,
  label: string,
  options: { value: string; label: string }[]
): FieldSchema => ({ key, label, type: 'select', width: 'half', options });

const kindField = (): FieldSchema =>
  choice('kind', 'Kind', [
    { value: 'heartbeat', label: 'Heartbeat' },
    { value: 'log', label: 'Log' },
  ]);

/* ---------- datasets ---------- */

/**
 * Live slice: the rolling buffer of real-time events (`LiveSlice.entries`).
 * Rendered newest first, so row 1 is the entry shown at the top of the list.
 */
const live: DatasetSchema = {
  id: 'live',
  title: 'Live feed entries',
  description:
    'Feeds the live list: the first 12 rows, newest first. Delete every row (or “Reset dataset” with an empty list) to show “Waiting for the first live event.” The chip and the session counter are the separate “Live chip & counter” dataset.',
  fields: [
    text('id', 'Event id', { readOnly: true }),
    kindField(),
    text('kioskId', 'Kiosk', { help: 'Empty shows no kiosk prefix.' }),
    when('timestamp', 'Timestamp'),
    text('message', 'Message', { width: 'full' }),
    liters('meterVolume', 'Meter volume (L)'),
  ],
  seeds: (now) =>
    Array.from({ length: LIVE_COUNT }, (_, index) => {
      const isHeartbeat = index % 4 === 0;
      const volume = 1200 + index * 37;
      return {
        id: LIVE_ID(index),
        kind: isHeartbeat ? 'heartbeat' : 'log',
        kioskId: KIOSK_ID,
        timestamp: localStamp(minutesBefore(now, index)),
        message: isHeartbeat ? heartbeatMessage() : logMessage(volume),
        meterVolume: isHeartbeat ? null : volume,
      } satisfies FixtureRow;
    }),
  makeRow: ({ now, index }) => ({
    id: `mock-live-new-${index + 1}`,
    kind: 'log',
    kioskId: KIOSK_ID,
    timestamp: localStamp(now),
    message: logMessage(1500),
    meterVolume: 1500,
  }),
  validate: (row) => {
    if (!row.message) return 'A live event needs a message.';
    if (!row.timestamp) return 'Timestamp is required.';
    return null;
  },
};

/** The live chip (`LiveSlice.status`) and the “events received this session” counter. */
const liveStatus: DatasetSchema = {
  id: 'liveStatus',
  title: 'Live chip & counter',
  description:
    'The stream state shown in the live chip (Not connected · Connecting · Live · Reconnecting) and the “{n} events received this session” counter. Independent of the rows on screen, exactly like the real slice.',
  singleton: true,
  fields: [
    choice('status', 'Stream status', [
      { value: 'idle', label: 'idle — Not connected' },
      { value: 'connecting', label: 'connecting — Connecting' },
      { value: 'open', label: 'open — Live' },
      { value: 'reconnecting', label: 'reconnecting — Reconnecting' },
    ]),
    count('received', 'Events received', { help: 'Session total; not capped by the visible list.' }),
  ],
  seeds: () => [{ status: 'open', received: 128 }],
  makeRow: () => ({ status: 'open', received: 0 }),
  validate: (row) => {
    if (typeof row.received !== 'number' || row.received < 0) {
      return 'Events received must be 0 or more.';
    }
    return null;
  },
};

/** Archive slice: the older entries fetched page by page (`ArchiveSlice.entries`). */
const archive: DatasetSchema = {
  id: 'archive',
  title: 'Archive entries',
  description:
    'Feeds the “Earlier entries” list. Mock rows always end the archive (“End of archive”), so the infinite-scroll sentinel and “Load more” can never request a real page. The loading line, error banner and empty state are the separate “Archive state” dataset.',
  fields: [
    text('id', 'Event id', { readOnly: true }),
    kindField(),
    text('kioskId', 'Kiosk', { help: 'Empty shows no kiosk prefix.' }),
    when('timestamp', 'Timestamp'),
    text('message', 'Message', { width: 'full' }),
    liters('meterVolume', 'Meter volume (L)'),
  ],
  seeds: (now) =>
    Array.from({ length: ARCHIVE_COUNT }, (_, index) => {
      const isHeartbeat = index % 3 === 0;
      const volume = 980 + index * 41;
      return {
        id: ARCHIVE_ID(index),
        kind: isHeartbeat ? 'heartbeat' : 'log',
        kioskId: KIOSK_ID,
        timestamp: localStamp(hoursBefore(now, index + 1)),
        message: isHeartbeat ? heartbeatMessage() : logMessage(volume),
        meterVolume: isHeartbeat ? null : volume,
      } satisfies FixtureRow;
    }),
  makeRow: ({ now, index }) => {
    const volume = 1000 + index * 10;
    return {
      id: `mock-archive-new-${index + 1}`,
      kind: 'log',
      kioskId: KIOSK_ID,
      timestamp: localStamp(hoursBefore(now, ARCHIVE_COUNT + index + 1)),
      message: logMessage(volume),
      meterVolume: volume,
    };
  },
  validate: (row) => {
    if (!row.message) return 'An archived entry needs a message.';
    if (!row.timestamp) return 'Timestamp is required.';
    return null;
  },
};

/**
 * Archive state: every non-row surface of the archive card. `hasMore` is listed
 * for completeness but the selector always reports `false` for fixtures, so no
 * mock state can ever trigger a page request.
 */
const archiveState: DatasetSchema = {
  id: 'archiveState',
  title: 'Archive state',
  description:
    'The loading line, the error banner with “Try again”, “No archived entries yet.”, “Load more”, “End of archive” and the infinite-scroll sentinel. “Has more pages” is always forced off for fixtures, so the sentinel and “Load more” cannot request a real page.',
  singleton: true,
  fields: [
    choice('status', 'Status', [
      { value: 'idle', label: 'idle — resting' },
      { value: 'loading', label: 'loading — fetching a page' },
      { value: 'error', label: 'error — banner + Try again' },
    ]),
    text('error', 'Error message', {
      width: 'full',
      help: 'Banner text when the status is “error”. Empty shows the default message.',
    }),
    flag('hasMore', 'Has more pages', 'Listed for parity — fixtures always end the archive.'),
    flag(
      'loadedOnce',
      'Loaded once',
      'Off hides “No archived entries yet.” and “Load more”.'
    ),
  ],
  seeds: () => [{ status: 'idle', error: '', hasMore: false, loadedOnce: true }],
  makeRow: () => ({
    status: 'error',
    error: 'Could not load older entries.',
    hasMore: false,
    loadedOnce: true,
  }),
};

/**
 * Header status pill, connection card copy, “Last response at …” and the device
 * `<dl>` rows (Kiosk ID, Network, Heartbeat).
 */
const kioskStatus: DatasetSchema = {
  id: 'kioskStatus',
  title: 'Kiosk status',
  description:
    'Drives the header pill (Connected · Connection lost · Checking server), the connection card copy, “Last response at …”, the Kiosk ID / Network / Heartbeat rows and the kiosk id in the header. The real heartbeat keeps running underneath and is simply not shown while this is on.',
  singleton: true,
  fields: [
    text('kioskId', 'Kiosk id', { help: 'Empty falls back to the configured kiosk id.' }),
    flag('browserOnline', 'Browser online'),
    choice('connection', 'Connection', [
      { value: 'connected', label: 'connected' },
      { value: 'retrying', label: 'retrying' },
      { value: 'dropped', label: 'dropped' },
    ]),
    choice('pingStatus', 'Heartbeat', [
      { value: 'idle', label: 'idle (waiting)' },
      { value: 'ok', label: 'ok' },
      { value: 'failed', label: 'failed' },
    ]),
    text('lastPingTime', 'Last response', {
      help: 'Text after “Last response at”. Empty shows “No heartbeat received yet”.',
    }),
  ],
  seeds: (now) => [
    {
      kioskId: KIOSK_ID,
      browserOnline: true,
      connection: 'connected',
      pingStatus: 'ok',
      lastPingTime: localClock(minutesBefore(now, 0)),
    },
  ],
  makeRow: ({ now }) => ({
    kioskId: KIOSK_ID,
    browserOnline: true,
    connection: 'connected',
    pingStatus: 'ok',
    lastPingTime: localClock(now),
  }),
};

export const MOCK_DATASETS: readonly DatasetSchema[] = [
  live,
  liveStatus,
  archive,
  archiveState,
  kioskStatus,
];
