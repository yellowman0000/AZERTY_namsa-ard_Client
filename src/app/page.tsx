'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import { useKioskHeartbeat } from '../lib/heartbeat';
import { submitTransactionLog, TransactionPayload, DuplicateTransactionError } from '../lib/api';
import { syncDispatcher } from '../lib/queue';
import { connectionStatus, ConnectionDroppedError } from '../lib/http';

export default function Home() {
  const kioskId = 'KIOSK-001';
  const [isOnline, setIsOnline] = useState(true);
  const [volume, setVolume] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Live connection state from the retry layer: 'connected' | 'retrying' | 'dropped'
  const connection = useSyncExternalStore(
    connectionStatus.subscribe,
    connectionStatus.get,
    () => 'connected' as const
  );

  // Ball's Heartbeat Hook (Story 01)
  const { lastPingTime, pingStatus } = useKioskHeartbeat({ kioskId, intervalMs: 10000 });

  // Monitor network status & auto-flush offline queue upon reconnection (Story 14-3)
  useEffect(() => {
    const updateStatus = async () => {
      const online = typeof window !== 'undefined' ? navigator.onLine : true;
      setIsOnline(online);
      setPendingCount(syncDispatcher.getQueue().length);

      if (online) {
        const res = await syncDispatcher.processQueue();
        if (res.processed > 0 || res.quarantined > 0) {
          setPendingCount(syncDispatcher.getQueue().length);
        }
      }
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();

    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  // Flush the queue when the retry layer reports the connection has recovered.
  useEffect(() => {
    if (connection !== 'connected' || !isOnline) return;
    (async () => {
      if (syncDispatcher.getQueue().length === 0) return;
      await syncDispatcher.processQueue();
      setPendingCount(syncDispatcher.getQueue().length);
    })();
  }, [connection, isOnline]);

  const enqueueOffline = async (payload: Omit<TransactionPayload, 'checksum'>, message: string) => {
    const enqueued = await syncDispatcher.enqueue(payload as TransactionPayload);
    setPendingCount(syncDispatcher.getQueue().length);
    alert(enqueued ? message : 'Duplicate transaction rejected by client idempotency check.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const recordPayload: Omit<TransactionPayload, 'checksum'> = {
      transaction_id: crypto.randomUUID(),
      kiosk_id: kioskId,
      meter_volume: Number(volume),
      recorded_at: new Date().toISOString(),
    };

    // Browser offline OR retries already exhausted: don't make the operator wait ~34 s again.
    if (!isOnline || connection === 'dropped') {
      await enqueueOffline(recordPayload, 'Offline Mode: Transaction saved to local queue.');
      return;
    }

    setSubmitting(true);
    try {
      // submitTransactionLog should use fetchWithRetry internally (5 s timeout, 2/4/8 s backoff)
      await submitTransactionLog(recordPayload);
      syncDispatcher.markProcessed(recordPayload.transaction_id);
      alert('Transaction submitted successfully!');
    } catch (err) {
      if (err instanceof DuplicateTransactionError) {
        alert('Duplicate submission detected & rejected by server.');
        return;
      }
      // Retries exhausted (or other failure): cache locally so nothing is lost.
      await enqueueOffline(
        recordPayload,
        err instanceof ConnectionDroppedError
          ? 'Connection dropped after retries: saved to local queue.'
          : 'Server unreachable: Cached in local queue.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const banner = !isOnline
    ? { label: 'Offline Mode', bg: '#f8d7da', fg: '#721c24' }
    : connection === 'dropped'
    ? { label: 'Connection Dropped', bg: '#f8d7da', fg: '#721c24' }
    : connection === 'retrying'
    ? { label: 'Reconnecting…', bg: '#fff3cd', fg: '#856404' }
    : { label: 'Online', bg: '#d4edda', fg: '#155724' };

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Prepaid Water Kiosk — Operator Node</h1>

      {/* Network Status Banner */}
      <div
        style={{
          padding: 12,
          borderRadius: 6,
          backgroundColor: banner.bg,
          color: banner.fg,
          marginBottom: 20,
        }}
      >
        Status: <strong>{banner.label}</strong> | Pending Queue Items: {pendingCount} | Heartbeat: <strong>{pingStatus === 'ok' ? `Connected (${lastPingTime})` : pingStatus === 'failed' ? 'Failed' : 'Connecting...'}</strong>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 320 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Water Meter Volume (Liters):
          <input
            type="number"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            required
            style={{ padding: 8, fontSize: 16 }}
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          style={{ padding: '10px 16px', fontSize: 16, cursor: submitting ? 'wait' : 'pointer' }}
        >
          {submitting ? (connection === 'retrying' ? 'Retrying…' : 'Submitting…') : 'Submit Entry'}
        </button>
      </form>
    </main>
  );
}