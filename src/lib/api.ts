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

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

/**
 * Prepares payload with SHA-256 checksum and submits to POST /api/logs
 */
export async function submitTransactionLog(
  payload: Omit<TransactionPayload, 'checksum'>,
  serverUrl = 'http://localhost:3000/api/logs'
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

  if (response.status === 422) {
    throw new CorruptedPayloadError('Checksum mismatch or corrupted payload');
  }

  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status}`);
  }

  return await response.json();
}