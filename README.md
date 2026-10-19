# AZERTY Namsa-Ard Client (Operator Kiosk Node)

Next.js operator interface and offline-first queue client for the Water Kiosk system (ITCS379 Practical Software Engineering - Sprint 1).

---

## Sprint 1 Features Implemented

1. **Heartbeat & Online/Offline Status Tracking (Story 01 - Ball)**
   - Periodic heartbeat pings to `/api/kiosk/heartbeat`.
   - Real-time connection status banner (`Online`, `Offline Mode`, `Reconnecting...`, `Connection Dropped`).

2. **Offline Data Storing Cache (Story 14-1 - Pun / Earn / Sour / Wuth)**
   - Local offline storage queue backed by `LocalStorage` (under key `offline_tx_queue`).
   - Queue manager with FIFO ordering (`enqueue`, `dequeue`, `peekAll`).
   - Visual offline status banner alerting operators when offline mode is activated.
   - Offline form submissions with persistent data retention across browser reloads.

3. **Offline Data Corrupted Checker (Story 14-2 - Ball / Project / Wuth / Earn)**
   - Deterministic SHA-256 checksum generation (`v1|kiosk:...|meter:...|recorded:...|txn:...`) stored alongside cached payloads.
   - Isolation and quarantine queue (`quarantine_queue`) for corrupted or schema-invalid records without blocking valid pending records.

4. **Sequential Auto-Sync Dispatcher (Story 14-3 - Pun / Ball / Sour / Project)**
   - Automated sequential background dispatcher flushing `offline_tx_queue` to `POST /api/kiosk/logs` upon network reconnection.
   - Exponential backoff retry loop and circuit breaker.

---

## Verification Guide: Offline Form Submissions & Data Retention

### Testing Task:
> **"Switch browser DevTools to `Offline`, submit 5 consecutive forms, refresh the browser, and verify all 5 records remain intact in client storage."**

### Step-by-Step Procedure

1. **Start the Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in Google Chrome or any Chromium-based browser.

2. **Simulate Network Cut (Switch to Offline)**:
   - Press `F12` or `Ctrl + Shift + I` to open **Chrome DevTools**.
   - Navigate to the **Network** tab.
   - In the throttling dropdown (labeled **No throttling** by default), select **Offline**.
   - Verify the UI status banner updates to:
     ```text
     Status: Offline Mode | Pending Queue Items: 0 | Heartbeat: Failed
     ```

3. **Submit 5 Consecutive Forms**:
   - Enter `10.5` into the **Water Meter Volume (Liters)** field and click **Submit Entry**.
     - An alert or confirmation confirms saving to local queue: `"Offline Mode: Transaction saved to local queue."`
     - Observe the banner update: `Pending Queue Items: 1`.
   - Enter `20.0` and click **Submit Entry** (`Pending Queue Items: 2`).
   - Enter `35.2` and click **Submit Entry** (`Pending Queue Items: 3`).
   - Enter `48.75` and click **Submit Entry** (`Pending Queue Items: 4`).
   - Enter `62.1` and click **Submit Entry** (`Pending Queue Items: 5`).

4. **Refresh the Browser**:
   - Keeping the network setting as **Offline** in DevTools, refresh the page (`F5` or `Ctrl + R`).

5. **Verify Data Retention**:
   - **On the UI**: The banner displays:
     ```text
     Status: Offline Mode | Pending Queue Items: 5
     ```
   - **In DevTools Storage**:
     - Navigate to **DevTools > Application tab > Storage > Local Storage > http://localhost:3000**.
     - Inspect the key `offline_tx_queue`.
     - Verify it contains a JSON array with all 5 records, each containing:
       - `transaction_id` (UUID)
       - `kiosk_id` (`"KIOSK-001"`)
       - `meter_volume` (e.g. `10.5`, `20`, `35.2`, `48.75`, `62.1`)
       - `recorded_at` (ISO-8601 timestamp)
       - `checksum` (SHA-256 digest)
       - `checksum_version` (`"v1"`)
       - `cached_at` (ISO timestamp)
   - Alternatively, run this in the DevTools **Console**:
     ```javascript
     const queue = JSON.parse(localStorage.getItem('offline_tx_queue') || '[]');
     console.log('Total offline records:', queue.length);
     console.table(queue.map(q => ({ id: q.transaction_id, volume: q.meter_volume, checksum: q.checksum.slice(0, 10) + '...' })));
     ```
   - You should see all 5 records intact with their volume readings and SHA-256 integrity checksums.
