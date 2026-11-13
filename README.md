# Nam Sa-ard Kiosk Client

The kiosk client monitors the kiosk's connection to the server and reports the latest heartbeat status. Operator water-volume entry and offline transaction handling live in the separate `clientOperator` repository.

## Kiosk status page

- Sends a heartbeat to `POST /api/kiosk/heartbeat` every 10 seconds.
- Shows server connectivity, the most recent heartbeat response, kiosk ID, and browser network status.
- Displays checking, connected, and connection-lost states using the Nam Sa-ard UI Kit colors.

## Mock data tool

The floating orb in the bottom-right corner opens a temporary fixture editor. It is a demo aid for screenshots, reviews and offline demos — not a monitoring mode.

- Click the orb (or the "Mock data active · N datasets" banner) to open the panel, then flip **Mock data on**. Every surface covered by a dataset switches to fixture rows; the banner stays visible so fixtures can never be mistaken for real records.
- While it is on, the app does not open the live `EventSource` (`/api/kiosk/stream`) and does not request archived entries: `useLiveFeed`, `useLiveSlice`, `useArchiveSlice` and `useArchiveLoader` are disabled, and the fixture archive always reports `hasMore: false`, so the infinite-scroll sentinel and "Load more" cannot fire a request.
- Fixtures live in memory only (a module store read through `useSyncExternalStore`). A reload clears them and starts with the tool switched off; client-side navigation keeps them because the store outlives route changes. Nothing is written to storage and nothing ever reaches the server.
- The real heartbeat ping keeps running underneath (every 10 s), but the status pill, connection card and device rows show fixture values while mock data is on.

| Dataset | Rows | Drives |
| --- | --- | --- |
| `live` | 12 | Live list (`first 12 entries`, newest first). Removing every row shows "Waiting for the first live event." |
| `liveStatus` | 1 | Live chip (Not connected / Connecting / Live / Reconnecting) and the "{n} events received this session" counter. |
| `archive` | 9 | The "Earlier entries" list. |
| `archiveState` | 1 | Loading line, error banner with "Try again", "No archived entries yet.", "Load more" and "End of archive". "Has more pages" is forced off for fixtures. |
| `kioskStatus` | 1 | Header pill, connection card copy, "Last response at …", and the device rows (Kiosk ID, Network, Heartbeat). |

Editing a row updates the kiosk screen immediately. "Reset dataset" restores one dataset's defaults, "Reset all" restores every dataset, and the master switch hides fixtures without discarding edits. Styling lives in `src/app/mockData.css`; the orb, banner and panel deliberately reuse the operator app's class names, keyframes and breakpoints.

## Run locally

Set `API_BASE_URL` to the server origin (defaults to `http://localhost:3001`). Next.js proxies `/api/*` requests to the server, so the browser does not need direct cross-origin access. Optionally set `NEXT_PUBLIC_KIOSK_ID` (defaults to `KIOSK-001`).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The kiosk view does not fabricate tank-level telemetry: it shows connection and heartbeat data available from the existing client/server integration.
