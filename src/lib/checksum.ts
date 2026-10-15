/**
 * Generates SHA-256 checksum for transaction verification.
 * Format: SHA-256(transaction_id + kiosk_id + meter_volume)
 */
export async function generatePayloadHash(
  transaction_id: string,
  kiosk_id: string,
  meter_volume: number
): Promise<string> {
  const rawString = `${transaction_id}${kiosk_id}${meter_volume}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(rawString);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}