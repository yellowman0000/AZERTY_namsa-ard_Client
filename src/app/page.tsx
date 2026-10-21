'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useKioskHeartbeat } from '../lib/heartbeat';
import { connectionStatus } from '../lib/http';

const kioskId = process.env.NEXT_PUBLIC_KIOSK_ID || 'KIOSK-001';

export default function KioskDashboard() {
  const [browserOnline, setBrowserOnline] = useState(true);
  const connection = useSyncExternalStore(
    connectionStatus.subscribe,
    connectionStatus.get,
    () => 'connected' as const
  );
  const { lastPingTime, pingStatus } = useKioskHeartbeat({
    kioskId,
    intervalMs: 10000,
  });

  useEffect(() => {
    const updateNetworkStatus = () => setBrowserOnline(navigator.onLine);
    updateNetworkStatus();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    return () => {
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('offline', updateNetworkStatus);
    };
  }, []);

  const status = !browserOnline
    ? 'offline'
    : connection === 'retrying'
      ? 'checking'
      : connection === 'dropped' || pingStatus === 'failed'
        ? 'offline'
        : pingStatus === 'ok'
          ? 'online'
          : 'checking';
  const statusLabel =
    status === 'online' ? 'Connected' : status === 'offline' ? 'Connection lost' : 'Checking server';

  return (
    <main className="kiosk-shell">
      <header className="topbar">
        <div className="brand" aria-label="Nam Sa-ard kiosk status">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48" role="presentation">
              <path d="M24 7C19 15 12 22 12 29a12 12 0 0 0 24 0C36 22 29 15 24 7Z" />
              <path className="brand-wave" d="M13 32c4-3 7 3 11 0s7 3 11 0" />
            </svg>
          </span>
          <span className="brand-name">namsa-ard</span>
          <span className="brand-subtitle">น้ำสะอาด</span>
        </div>
        <div className={`status-pill status-${status}`} aria-live="polite">
          <span className="status-dot" />
          {statusLabel}
        </div>
      </header>

      <section className="dashboard">
        <div className="intro">
          <p className="eyebrow">KIOSK NETWORK MONITOR</p>
          <h1>System status</h1>
          <p className="intro-copy">This kiosk checks its connection to the water service automatically.</p>
        </div>

        <div className="status-layout">
          <section className={`connection-card connection-${status}`} aria-labelledby="connection-title">
            <div className="connection-card-top">
              <span className="card-kicker">SERVER CONNECTION</span>
              <span className="heartbeat-tag">
                <span className="pulse-dot" />
                HEARTBEAT · 10 SEC
              </span>
            </div>
            <div className="connection-main">
              <div className="connection-copy">
                <p className="connection-overline">Kiosk is</p>
                <h2 id="connection-title">{statusLabel}</h2>
                <p>
                  {status === 'online'
                    ? 'The server is responding and this kiosk is ready.'
                    : status === 'offline'
                      ? 'The server has not confirmed a heartbeat. Service may be unavailable.'
                      : 'Waiting for the first heartbeat response.'}
                </p>
              </div>
              <div className="water-orbit" aria-hidden="true">
                <div className="water-orbit-inner">
                  <svg viewBox="0 0 64 64">
                    <path d="M32 8C25 20 16 28 16 39a16 16 0 0 0 32 0C48 28 39 20 32 8Z" />
                    <path className="orbit-wave" d="M17 42c5-4 9 4 15 0s10 4 15 0" />
                  </svg>
                </div>
                <span className="orbit-ring orbit-ring-one" />
                <span className="orbit-ring orbit-ring-two" />
              </div>
            </div>
            <div className="heartbeat-row">
              <span className="heartbeat-wave" aria-hidden="true">
                <svg viewBox="0 0 160 34" preserveAspectRatio="none">
                  <path d="M0 18h38l8-9 10 18 12-25 11 18h18l8-8 9 8h46" />
                </svg>
              </span>
              <span>{lastPingTime ? `Last response at ${lastPingTime}` : 'No heartbeat received yet'}</span>
            </div>
          </section>

          <aside className="details-card" aria-label="Kiosk details">
            <div className="details-heading">
              <span className="details-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.7 7.5 9.5 4.3-.8 7.5-4.9 7.5-9.5V6L12 3Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </span>
              <div>
                <p className="card-kicker">DEVICE</p>
                <h2>Connection details</h2>
              </div>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Kiosk ID</dt>
                <dd>{kioskId}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{browserOnline ? 'Available' : 'Offline'}</dd>
              </div>
              <div>
                <dt>Heartbeat</dt>
                <dd>{pingStatus === 'ok' ? 'Acknowledged' : pingStatus === 'failed' ? 'No response' : 'Waiting'}</dd>
              </div>
            </dl>
            <p className="details-note">Status refreshes every 10 seconds. Keep this screen open to monitor the kiosk.</p>
          </aside>
        </div>
      </section>
      <footer className="page-footer">
        <span>Nam Sa-ard · Water kiosk</span>
        <span>Live service monitor</span>
      </footer>
    </main>
  );
}
