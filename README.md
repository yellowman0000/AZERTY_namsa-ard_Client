# Nam Sa-ard Kiosk Client

The kiosk client monitors the kiosk's connection to the server and reports the latest heartbeat status. Operator water-volume entry and offline transaction handling live in the separate `clientOperator` repository.

## Kiosk status page

- Sends a heartbeat to `POST /api/kiosk/heartbeat` every 10 seconds.
- Shows server connectivity, the most recent heartbeat response, kiosk ID, and browser network status.
- Displays checking, connected, and connection-lost states using the Nam Sa-ard UI Kit colors.

## Historical logs (Operation Managers)

`/manager` lists submitted daily logs, newest first (`GET /api/kiosk/logs`, 20 per page with **Load older logs**). **Inspect** opens a read-only modal that fetches `GET /api/kiosk/logs/:id/inspect`. The server recomputes the record's SHA-256 checksum on every open and on **Verify again**, and the modal shows:

- **Verified (Tamper-Evident)** (green): the stored record still matches the checksum saved at submission.
- **Checksum Mismatch** (red): the record changed after submission. The stored and recomputed hashes are shown side by side.
- **No checksum on record** (amber): the log was submitted without a checksum, so it can't be verified.

The modal has no edit controls, and both endpoints are GET-only.

## Run locally

Set `API_BASE_URL` to the server origin (defaults to `http://localhost:3001`). Next.js proxies `/api/*` requests to the server, so the browser does not need direct cross-origin access. Optionally set `NEXT_PUBLIC_KIOSK_ID` (defaults to `KIOSK-001`).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), or [http://localhost:3000/manager](http://localhost:3000/manager) for the historical logs.

Run the unit tests with `bun test src/lib/__tests__`.

The kiosk view does not fabricate tank-level telemetry: it shows connection and heartbeat data available from the existing client/server integration.
