import { generatePayloadHash } from './checksum';
import { fetchWithRetry } from './http';

export interface TransactionPayload {
  transaction_id: string;
  kiosk_id: string;
  meter_volume: number;
  recorded_at: string;
  checksum?: string;
}

export class CorruptedPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptedPayloadError';
  }
}

export class DuplicateTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateTransactionError';
  }
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

/**
 * Prepares payload with SHA-256 checksum and submits to POST /api/logs
 *
 * Network behaviour (see ./http):
 *  - 5 s timeout per attempt
 *  - on timeout / network error / 5xx: retry after 2 s, 4 s, 8 s
 *  - if all attempts fail, throws ConnectionDroppedError
 *
 * Idempotency: HTTP 409 means the server already has this transaction_id.
 * If we had to retry, the earlier attempt most likely reached the server
 * (e.g. its response timed out), so a 409 on a retry is treated as success.
 */
export async function submitTransactionLog(
  payload: Omit<TransactionPayload, 'checksum'>,
  serverUrl = `${API_BASE_URL}/api/logs`
): Promise<{ ack: boolean; status?: string }> {
  const checksum = await generatePayloadHash(
    payload.transaction_id,
    payload.kiosk_id,
    payload.meter_volume
  );

  const finalPayload: TransactionPayload = {
    ...payload,
    checksum,
  };

  let retried = false;

  const response = await fetchWithRetry(
    serverUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalPayload),
    },
    {
      onRetry: (attempt, delayMs) => {
        retried = true;
        console.warn(`[API] Attempt ${attempt} failed, retrying in ${delayMs / 1000}s...`);
      },
    }
  );

  if (response.status === 409) {
    if (retried) {
      // The first attempt landed; only its response was lost.
      return { ack: true, status: 'already_recorded' };
    }
    throw new DuplicateTransactionError(
      `Duplicate transaction rejected: ${payload.transaction_id}`
    );
  }

  if (response.status === 422) {
    throw new CorruptedPayloadError('Checksum mismatch or corrupted payload');
  }

  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status}`);
  }

  return await response.json();
}