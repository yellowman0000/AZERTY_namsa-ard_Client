import { generatePayloadChecksum, generatePayloadHash, CURRENT_CHECKSUM_VERSION } from './checksum';
import { fetchWithRetry } from './http';

export interface TransactionPayload {
  transaction_id: string;
  kiosk_id: string;
  meter_volume: number;
  recorded_at: string;
  checksum?: string;
  checksum_version?: string;
  cached_at?: string;
  quarantined_at?: string;
  quarantine_reason?: string;
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

export interface SubmitLogOptions {
  serverUrl?: string;
  retryDelaysMs?: number[];
  timeoutMs?: number;
}

/**
 * Prepares payload with SHA-256 checksum and submits to POST /api/kiosk/logs (or /api/logs)
 *
 * Network behaviour (see ./http):
 *  - 5 s timeout per attempt
 *  - on timeout / network error / 5xx: retry after 2 s, 4 s, 8 s (or custom retryDelaysMs)
 *  - if all attempts fail, throws ConnectionDroppedError
 *
 * Idempotency: HTTP 409 means the server already has this transaction_id.
 * If we had to retry, the earlier attempt most likely reached the server
 * (e.g. its response timed out), so a 409 on a retry is treated as success.
 */
export async function submitTransactionLog(
  payload: TransactionPayload | Omit<TransactionPayload, 'checksum'>,
  serverUrlOrOptions: string | SubmitLogOptions = `${API_BASE_URL}/api/kiosk/logs`
): Promise<{ ack: boolean; status?: string; logId?: string }> {
  const options: SubmitLogOptions =
    typeof serverUrlOrOptions === 'string'
      ? { serverUrl: serverUrlOrOptions }
      : serverUrlOrOptions;

  const serverUrl = options.serverUrl || `${API_BASE_URL}/api/kiosk/logs`;
  const retryDelaysMs = options.retryDelaysMs;

  // Use existing stored checksum if available; otherwise generate deterministic checksum
  let checksum = 'checksum' in payload ? payload.checksum : undefined;
  let checksumVersion = (payload as TransactionPayload).checksum_version;

  if (!checksum) {
    const checksumResult = await generatePayloadChecksum(payload, {
      version: CURRENT_CHECKSUM_VERSION,
    });
    checksum = checksumResult.checksum;
    checksumVersion = checksumResult.version;
  }

  // Format request body compatible with NestJS IngestLogDto (camelCase) and client (snake_case)
  const bodyPayload = {
    transactionId: payload.transaction_id,
    kioskId: payload.kiosk_id,
    meterVolume: payload.meter_volume,
    recordedAt: payload.recorded_at,
    checksum,
    // snake_case preserved for client & legacy servers
    transaction_id: payload.transaction_id,
    kiosk_id: payload.kiosk_id,
    meter_volume: payload.meter_volume,
    recorded_at: payload.recorded_at,
    checksum_version: checksumVersion,
  };

  let retried = false;

  const response = await fetchWithRetry(
    serverUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    },
    {
      ...(retryDelaysMs !== undefined ? { retryDelaysMs } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
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

  if (response.status === 400) {
    let errorDetail = 'Bad Request / Invalid payload schema';
    try {
      const errorJson = await response.json();
      if (Array.isArray(errorJson?.message)) {
        errorDetail = errorJson.message.join(', ');
      } else if (typeof errorJson?.message === 'string') {
        errorDetail = errorJson.message;
      }
    } catch {
      // response might not be json
    }
    throw new CorruptedPayloadError(`Server rejected invalid payload: ${errorDetail}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status}`);
  }

  return await response.json();
}