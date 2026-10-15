'use client';

import { useState, useEffect } from 'react';
import { useKioskHeartbeat } from '../lib/heartbeat';
import { submitTransactionLog, TransactionPayload, DuplicateTransactionError } from '../lib/api';
import { syncDispatcher } from '../lib/queue';

export default function Home() {
  const kioskId = 'KIOSK-001';
  const [isOnline, setIsOnline] = useState(true);
  const [volume, setVolume] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState(0);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const recordPayload: Omit<TransactionPayload, 'checksum'> = {
      transaction_id: crypto.randomUUID(),
      kiosk_id: kioskId,
      meter_volume: Number(volume),
      recorded_at: new Date().toISOString(),
    };

    if (!isOnline) {
      // Offline fallback: store in local storage queue (Story 14-1) with idempotency check
      const enqueued = await syncDispatcher.enqueue(recordPayload as TransactionPayload);
      setPendingCount(syncDispatcher.getQueue().length);
      if (enqueued) {
        alert('Offline Mode: Transaction saved to local queue.');
      } else {
        alert('Duplicate transaction rejected by client idempotency check.');
      }
    } else {
      try {
        await submitTransactionLog(recordPayload);
        syncDispatcher.markProcessed(recordPayload.transaction_id);
        alert('Transaction submitted successfully!');
      } catch (err) {
        if (err instanceof DuplicateTransactionError) {
          alert('Duplicate submission detected & rejected by server.');
          return;
        }
        // Fallback on network/server drop
        const enqueued = await syncDispatcher.enqueue(recordPayload as TransactionPayload);
        setPendingCount(syncDispatcher.getQueue().length);
        if (enqueued) {
          alert('Server unreachable: Cached in local queue.');
        }
      }
    }
  };

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Prepaid Water Kiosk — Operator Node</h1>
      
      {/* Network Status Banner */}
      <div
        style={{
          padding: 12,
          borderRadius: 6,
          backgroundColor: isOnline ? '#d4edda' : '#f8d7da',
          color: isOnline ? '#155724' : '#721c24',
          marginBottom: 20,
        }}
      >
        Status: <strong>{isOnline ? 'Online' : 'Offline Mode'}</strong> | Pending Queue Items: {pendingCount} | Heartbeat: <strong>{pingStatus === 'ok' ? `Connected (${lastPingTime})` : pingStatus === 'failed' ? 'Failed' : 'Connecting...'}</strong>
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

        <button type="submit" style={{ padding: '10px 16px', fontSize: 16, cursor: 'pointer' }}>
          Submit Entry
        </button>
      </form>
    </main>
  );
}