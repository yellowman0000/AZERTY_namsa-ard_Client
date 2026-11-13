'use client';

import { useEffect, useRef } from 'react';
import {
  useArchiveLoader,
  useArchiveSlice,
  useLiveFeed,
  useLiveSlice,
  type ArchiveSlice,
  type FeedEntry,
  type LiveSlice,
} from '../lib/logFeed';
import {
  rowsOf,
  selectArchiveFeed,
  selectLiveFeed,
} from '../lib/mockData/selectors';
import { useMockData } from '../lib/mockData/useMockData';
import './logFeed.css';
const LIVE_VISIBLE = 12;

const liveLabel = {
  idle: 'Not connected',
  connecting: 'Connecting',
  open: 'Live',
  reconnecting: 'Reconnecting',
} as const;

function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function EntryRow({ entry }: { entry: FeedEntry }) {
  return (
    <li className={`feed-row feed-row-${entry.kind}`}>
      <span className="feed-mark" aria-hidden="true">
        {entry.kind === 'heartbeat' ? 'H' : 'L'}
      </span>
      <span className="feed-info">
        <strong>{entry.message}</strong>
        <small>
          {entry.kioskId ? `${entry.kioskId} · ` : ''}
          {formatTime(entry.timestamp)}
        </small>
      </span>
      <span className="feed-kind">{entry.kind === 'heartbeat' ? 'Heartbeat' : 'Log'}</span>
    </li>
  );
}

export default function LogFeed({ kioskId }: { kioskId: string }) {
  const mock = useMockData();
  const mockActive = mock.active;
  // While fixtures are on, both real transports are held back: no EventSource and
  // no archive request. Turning mock data off re-enables them unchanged.
  const transportsEnabled = !mockActive;

  useLiveFeed(kioskId, transportsEnabled);
  const liveSlice = useLiveSlice(transportsEnabled);
  const archiveSlice = useArchiveSlice(transportsEnabled);
  const loader = useArchiveLoader(kioskId, transportsEnabled);

  // Fixtures are derived during render, so toggling mock data on never starts a
  // fetch and editing a fixture row never re-runs an effect — only the slices do.
  const fixtureLive: LiveSlice | null = mockActive
    ? selectLiveFeed(rowsOf(mock, 'live'), rowsOf(mock, 'liveStatus')[0])
    : null;
  const live = fixtureLive ?? liveSlice;

  const fixtureArchive: ArchiveSlice | null = mockActive
    ? selectArchiveFeed(rowsOf(mock, 'archive'), rowsOf(mock, 'archiveState')[0])
    : null;
  const archive = fixtureArchive ?? archiveSlice;

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll: when the sentinel at the bottom of the archive list scrolls into
  // view, request the next page. The observer is re-created after every page so a list
  // that is still too short to scroll keeps loading. After an error it stays quiet
  // (no retry loop); the "Try again" button resumes loading.
  // Mocked archives always report `hasMore: false`, so the sentinel stays inert on top
  // of the transport being disabled.
  const canAutoLoad =
    transportsEnabled && archive.hasMore && archive.status === 'idle' && archive.loadedOnce;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!canAutoLoad || !sentinel || !root || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loader.loadMore();
      },
      { root, rootMargin: '0px 0px 120px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canAutoLoad, archive.entries.length, loader]);

  return (
    <div className="feed-layout">
      <section className="feed-card" aria-labelledby="live-feed-title">
        <div className="feed-heading">
          <div>
            <p className="card-kicker">REAL-TIME</p>
            <h2 id="live-feed-title">Live heartbeat &amp; logs</h2>
          </div>
          <span className={`feed-chip feed-chip-${live.status}`} aria-live="polite">
            <span className="status-dot" />
            {liveLabel[live.status]}
          </span>
        </div>
        {live.entries.length > 0 ? (
          <ul className="feed-list" aria-live="off">
            {live.entries.slice(0, LIVE_VISIBLE).map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : (
          <p className="feed-empty">Waiting for the first live event.</p>
        )}
        <p className="feed-note">{live.received.toLocaleString()} events received this session</p>
      </section>

      <section className="feed-card" aria-labelledby="archive-feed-title">
        <div className="feed-heading">
          <div>
            <p className="card-kicker">ARCHIVE</p>
            <h2 id="archive-feed-title">Earlier entries</h2>
          </div>
        </div>

        <div className="feed-scroll" ref={scrollRef} tabIndex={0} aria-label="Archived entries">
          {archive.entries.length > 0 && (
            <ul className="feed-list">
              {archive.entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}

          {archive.status === 'loading' && (
            <p className="feed-empty" role="status">
              Loading older entries…
            </p>
          )}

          {archive.status === 'error' && (
            <div className="feed-error" role="alert">
              <span>{archive.error ?? 'Could not load older entries.'}</span>
              <button type="button" onClick={() => void loader.loadMore()}>
                Try again
              </button>
            </div>
          )}

          {archive.status === 'idle' && archive.loadedOnce && archive.entries.length === 0 && (
            <p className="feed-empty">No archived entries yet.</p>
          )}

          {archive.status === 'idle' && archive.hasMore && archive.loadedOnce && (
            <button className="feed-more" type="button" onClick={() => void loader.loadMore()}>
              Load more
            </button>
          )}

          {!archive.hasMore && archive.entries.length > 0 && (
            <p className="feed-note">End of archive</p>
          )}

          <div ref={sentinelRef} className="feed-sentinel" aria-hidden="true" />
        </div>
      </section>
    </div>
  );
}
