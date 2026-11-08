/**
 * Turns whatever the server sends (SSE payloads and archive pages) into FeedEntry.
 *
 * The server contract isn't fixed in this repo, so parsing is deliberately tolerant of
 * camelCase / snake_case and a few common envelope shapes. If your server uses other
 * field names, this is the only file that needs to change.
 */
import type { FeedEntry, FeedKind } from './store';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

export function normalizeEntry(raw: unknown, fallbackKind?: FeedKind): FeedEntry | null {
  if (!isRecord(raw)) return null;

  const rawKind = firstString(raw, ['kind', 'type', 'event']);
  const kind: FeedKind =
    rawKind === 'heartbeat' || rawKind === 'log' ? rawKind : (fallbackKind ?? 'log');

  const kioskId = firstString(raw, ['kioskId', 'kiosk_id']);
  const timestamp =
    firstString(raw, [
      'timestamp',
      'recordedAt',
      'recorded_at',
      'createdAt',
      'created_at',
      'receivedAt',
      'received_at',
      'client_timestamp',
    ]) ?? new Date().toISOString();
  const meterVolume = firstNumber(raw, ['meterVolume', 'meter_volume', 'volume']);

  const id =
    firstString(raw, ['id', 'logId', 'log_id', 'transactionId', 'transaction_id', 'eventId']) ??
    // Heartbeats usually have no id: kiosk + timestamp is stable across replays.
    `${kind}:${kioskId ?? 'unknown'}:${timestamp}`;

  const explicit = firstString(raw, ['message', 'description']);
  const message =
    explicit ??
    (kind === 'heartbeat'
      ? `Heartbeat from ${kioskId ?? 'kiosk'}`
      : meterVolume !== null
        ? `Meter reading ${meterVolume.toLocaleString()} L`
        : 'Log entry');

  return { id, kind, kioskId, timestamp, message, meterVolume };
}

export interface ArchivePage {
  entries: FeedEntry[];
  /** null = no further pages. */
  nextCursor: string | null;
}

/**
 * Accepted archive response shapes:
 *   { items | data | logs | results: [...], nextCursor | next_cursor: string | null }
 *   { items: [...], page, totalPages }            -> cursor is the next page number
 *   { items: [...], hasMore: boolean }            -> cursor falls back to the last entry id
 *   [...]                                         -> bare array; a full page means "maybe more"
 */
export function parseArchivePage(body: unknown, pageSize: number): ArchivePage {
  const list = Array.isArray(body)
    ? body
    : isRecord(body)
      ? (['items', 'data', 'logs', 'results'] as const)
          .map((key) => body[key])
          .find((candidate) => Array.isArray(candidate))
      : undefined;

  if (!Array.isArray(list)) {
    throw new Error('Archive response did not contain a list of entries.');
  }

  const entries = list
    .map((item) => normalizeEntry(item))
    .filter((entry): entry is FeedEntry => entry !== null);
  const lastId = entries.length ? entries[entries.length - 1].id : null;

  if (isRecord(body)) {
    if ('nextCursor' in body || 'next_cursor' in body) {
      const cursor = body.nextCursor ?? body.next_cursor;
      return {
        entries,
        nextCursor: typeof cursor === 'string' || typeof cursor === 'number' ? String(cursor) : null,
      };
    }
    const page = firstNumber(body, ['page']);
    const totalPages = firstNumber(body, ['totalPages', 'total_pages']);
    if (page !== null && totalPages !== null) {
      return { entries, nextCursor: page < totalPages ? String(page + 1) : null };
    }
    if (typeof body.hasMore === 'boolean') {
      return { entries, nextCursor: body.hasMore ? lastId : null };
    }
  }

  return { entries, nextCursor: entries.length >= pageSize ? lastId : null };
}