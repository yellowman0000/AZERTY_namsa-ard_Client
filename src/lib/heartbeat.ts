import { useState, useEffect } from 'react';

interface HeartbeatOptions {
  kioskId: string;
  intervalMs?: number;
  serverUrl?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

/**
 * Sends a periodic heartbeat ping to POST /api/heartbeat every 10 seconds.
 */
export function useKioskHeartbeat({
  kioskId,
  intervalMs = 10000,
  serverUrl = `${API_BASE_URL}/api/heartbeat`,
}: HeartbeatOptions) {
  const [lastPingTime, setLastPingTime] = useState<string | null>(null);
  const [pingStatus, setPingStatus] = useState<'idle' | 'ok' | 'failed'>('idle');

  useEffect(() => {
    if (!kioskId) return;

    const sendHeartbeat = async () => {
      if (typeof window !== 'undefined' && !window.navigator.onLine) {
        console.warn('[Heartbeat] Offline, skipping ping.');
        setPingStatus('failed');
        return;
      }

      try {
        console.log(`[Heartbeat] Sending ping to ${serverUrl} (kiosk: ${kioskId})...`);
        const res = await fetch(serverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kiosk_id: kioskId,
            client_timestamp: new Date().toISOString(),
          }),
        });

        if (res.ok) {
          const data = await res.json().catch(() => null);
          console.log('[Heartbeat] Ping acknowledged by server:', data);
          setPingStatus('ok');
          setLastPingTime(new Date().toLocaleTimeString());
        } else {
          console.warn(`[Heartbeat] Ping returned status ${res.status}`);
          setPingStatus('failed');
        }
      } catch (err) {
        console.warn('[Heartbeat] Ping failed:', err);
        setPingStatus('failed');
      }
    };

    sendHeartbeat();
    const timer = setInterval(sendHeartbeat, intervalMs);
    return () => clearInterval(timer);
  }, [kioskId, intervalMs, serverUrl]);

  return { lastPingTime, pingStatus };
}