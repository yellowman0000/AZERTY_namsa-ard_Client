import { useEffect } from 'react';

interface HeartbeatOptions {
  kioskId: string;
  intervalMs?: number;
  serverUrl?: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
/**
 * Sends a periodic heartbeat ping to POST /api/heartbeat every 10 seconds.
 */
export function useKioskHeartbeat({
  kioskId,
  intervalMs = 10000,
  serverUrl = 'http://localhost:3000/api/heartbeat',
}: HeartbeatOptions) {
  useEffect(() => {
    if (!kioskId) return;

    const sendHeartbeat = async () => {
      if (typeof window !== 'undefined' && !window.navigator.onLine) {
        return;
      }

      try {
        await fetch(serverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kiosk_id: kioskId,
            client_timestamp: new Date().toISOString(),
          }),
        });
      } catch (err) {
        console.warn('[Heartbeat] Ping failed:', err);
      }
    };

    sendHeartbeat();
    const timer = setInterval(sendHeartbeat, intervalMs);
    return () => clearInterval(timer);
  }, [kioskId, intervalMs, serverUrl]);
}