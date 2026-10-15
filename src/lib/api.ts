import { generatePayloadHash } from './checksum';

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
 * Includes idempotency check handling (HTTP 409 Conflict for duplicate retries).
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

  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finalPayload),
  });

  // Idempotency: Server rejects duplicate submission from retries
  if (response.status === 409) {
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