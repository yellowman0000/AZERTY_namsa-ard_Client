/**
 * Pure adapters from editable fixture rows to the app's real view models.
 *
 * Everything here is a pure function of its arguments (no clock, no storage), so
 * it is unit-tested directly and safe to call during render. Date fields are
 * stored as local `datetime-local` strings; `fixtureIso` converts them to the ISO
 * strings `FeedEntry` expects and fills safe fallbacks for half-edited rows.
 *
 * `LiveSlice` and `ArchiveSlice` are produced directly, which is what lets
 * `LogFeed` derive fixtures during render instead of copying state in an effect.
 */
import type { ConnectionStatus } from '../http';
import type {
  ArchiveSlice,
  ArchiveStatus,
  FeedEntry,
  LiveSlice,
  LiveStatus,
} from '../logFeed/store';
import type { FixtureRow, FixtureValue, MockSnapshot } from './types';

/* ---------- value readers ---------- */

/** `undefined` is accepted so `row?.key` reads work without a guard. */
export function readText(value: FixtureValue | undefined): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

export function readNumber(value: FixtureValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readBoolean(value: FixtureValue | undefined): boolean {
  return value === true || value === 'true';
}

/** Parse a `datetime-local` or ISO string; null when empty or unreadable. */
export function fixtureDate(value: FixtureValue | undefined): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function fixtureIso(value: FixtureValue | undefined): string | null {
  const date = fixtureDate(value);
  return date ? date.toISOString() : null;
}

/* ---------- dataset selection ---------- */

/** Rows of one dataset from a snapshot; never null, so callers can map directly. */
export function rowsOf(snapshot: MockSnapshot, datasetId: string): readonly FixtureRow[] {
  return snapshot.datasets[datasetId] ?? [];
}

/* ---------- log feed ---------- */

/** One fixture row as the `FeedEntry` the feed list renders. */
export function toFeedEntry(row: FixtureRow): FeedEntry {
  const kioskId = readText(row.kioskId);
  return {
    id: readText(row.id),
    kind: readText(row.kind) === 'heartbeat' ? 'heartbeat' : 'log',
    kioskId: kioskId === '' ? null : kioskId,
    // An unreadable timestamp survives as '' so the row still renders.
    timestamp: fixtureIso(row.timestamp) ?? '',
    message: readText(row.message),
    meterVolume: readNumber(row.meterVolume),
  };
}

const LIVE_STATUSES: readonly LiveStatus[] = ['idle', 'connecting', 'open', 'reconnecting'];

/**
 * The live slice: feed rows plus the singleton `liveStatus` row (chip state and
 * session counter). Missing or malformed values fall back to a coherent slice.
 */
export function selectLiveFeed(
  rows: readonly FixtureRow[],
  statusRow: FixtureRow | undefined
): LiveSlice {
  const status = readText(statusRow?.status) as LiveStatus;
  const received = readNumber(statusRow?.received);
  return {
    entries: rows.map(toFeedEntry),
    status: LIVE_STATUSES.includes(status) ? status : 'idle',
    received: received === null ? rows.length : Math.max(0, Math.round(received)),
  };
}

const ARCHIVE_STATUSES: readonly ArchiveStatus[] = ['idle', 'loading', 'error'];

/**
 * The archive slice: feed rows plus the singleton `archiveState` row.
 *
 * `hasMore` and `cursor` are pinned to the terminal page on purpose: fixtures
 * must never page. Even if the panel's "Has more pages" box is ticked, the
 * infinite-scroll sentinel and "Load more" stay inert and no request is made.
 */
export function selectArchiveFeed(
  rows: readonly FixtureRow[],
  stateRow: FixtureRow | undefined
): ArchiveSlice {
  const status = readText(stateRow?.status) as ArchiveStatus;
  const safeStatus: ArchiveStatus = ARCHIVE_STATUSES.includes(status) ? status : 'idle';
  const error = readText(stateRow?.error);
  return {
    entries: rows.map(toFeedEntry),
    cursor: null,
    hasMore: false,
    status: safeStatus,
    error: safeStatus === 'error' && error !== '' ? error : null,
    loadedOnce: readBoolean(stateRow?.loadedOnce),
  };
}

/* ---------- kiosk status ---------- */

export interface MockKioskStatus {
  kioskId: string;
  browserOnline: boolean;
  connection: ConnectionStatus;
  pingStatus: 'idle' | 'ok' | 'failed';
  lastPingTime: string | null;
}

const CONNECTIONS: readonly ConnectionStatus[] = ['connected', 'retrying', 'dropped'];
const PING_STATUSES: readonly MockKioskStatus['pingStatus'][] = ['idle', 'ok', 'failed'];

export function selectKioskStatus(row: FixtureRow | undefined): MockKioskStatus | null {
  if (!row) return null;
  const connection = readText(row.connection) as ConnectionStatus;
  const pingStatus = readText(row.pingStatus) as MockKioskStatus['pingStatus'];
  const lastPingTime = readText(row.lastPingTime);
  return {
    kioskId: readText(row.kioskId),
    browserOnline: readBoolean(row.browserOnline),
    connection: CONNECTIONS.includes(connection) ? connection : 'connected',
    pingStatus: PING_STATUSES.includes(pingStatus) ? pingStatus : 'idle',
    lastPingTime: lastPingTime === '' ? null : lastPingTime,
  };
}
