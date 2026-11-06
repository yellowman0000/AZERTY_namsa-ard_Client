# Nam Sa-ard Kiosk Client

The kiosk client monitors the kiosk's connection to the server and reports the latest heartbeat status. Operator water-volume entry and offline transaction handling live in the separate `clientOperator` repository.

## Kiosk status page

- Sends a heartbeat to `POST /api/kiosk/heartbeat` every 10 seconds.
- Shows server connectivity, the most recent heartbeat response, kiosk ID, and browser network status.
- Displays checking, connected, and connection-lost states using the Nam Sa-ard UI Kit colors.

## Run locally

Set `API_BASE_URL` to the server origin (defaults to `http://localhost:3001`). Next.js proxies `/api/*` requests to the server, so the browser does not need direct cross-origin access. Optionally set `NEXT_PUBLIC_KIOSK_ID` (defaults to `KIOSK-001`).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The kiosk view does not fabricate tank-level telemetry: it shows connection and heartbeat data available from the existing client/server integration.
