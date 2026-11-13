import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MockPanel from '../../app/MockPanel';
import { MockBanner, MockOrb } from '../../app/MockOrb';
import { MOCK_DATASETS, localClock, localDay, localStamp } from '../mockData/datasets';
import { createMockDataStore } from '../mockData/store';
import {
  readBoolean,
  readNumber,
  readText,
  rowsOf,
  selectArchiveFeed,
  selectKioskStatus,
  selectLiveFeed,
  toFeedEntry,
} from '../mockData/selectors';
import type { FixtureRow, MockDataStore, MockSnapshot } from '../mockData/types';

const NOW = new Date(2026, 10, 13, 20, 30, 0);
const noop = () => {};

const byId = new Map(MOCK_DATASETS.map((dataset) => [dataset.id, dataset]));

function newStore(): MockDataStore {
  return createMockDataStore(MOCK_DATASETS);
}

function seeds(datasetId: string): readonly FixtureRow[] {
  return byId.get(datasetId)?.seeds(NOW) ?? [];
}

function datasetIds(store: MockDataStore): string[] {
  return Object.keys(store.getSnapshot().datasets).sort();
}

describe('mock data store', () => {
  it('starts (and stays) deterministic and empty on the server snapshot', () => {
    const store = newStore();
    const server = store.getServerSnapshot();

    expect(store.getServerSnapshot()).toBe(server);
    expect(server.active).toBe(false);
    expect(server.revision).toBe(0);
    expect(Object.isFrozen(server)).toBe(true);
    expect(server.selectedDataset).toBe('live');
    expect(datasetIds(store)).toEqual(MOCK_DATASETS.map((dataset) => dataset.id).sort());
    for (const id of datasetIds(store)) {
      expect(rowsOf(server, id)).toHaveLength(0);
    }
  });

  it('seeds every dataset on activate and notifies subscribers', () => {
    const store = newStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.activate(NOW);

    const snapshot = store.getSnapshot();
    expect(snapshot.active).toBe(true);
    expect(snapshot.revision).toBeGreaterThan(0);
    expect(rowsOf(snapshot, 'live')).toHaveLength(12);
    expect(rowsOf(snapshot, 'liveStatus')).toHaveLength(1);
    expect(rowsOf(snapshot, 'archive')).toHaveLength(9);
    expect(rowsOf(snapshot, 'archiveState')).toHaveLength(1);
    expect(rowsOf(snapshot, 'kioskStatus')).toHaveLength(1);
    expect(notifications).toBeGreaterThan(0);

    unsubscribe();
  });

  it('seeds exactly what the schemas produce for the given now', () => {
    const store = newStore();
    store.activate(NOW);
    const snapshot = store.getSnapshot();

    for (const dataset of MOCK_DATASETS) {
      expect(rowsOf(snapshot, dataset.id)).toEqual(dataset.seeds(NOW));
      // Deterministic: the same `now` always yields the same rows.
      expect(dataset.seeds(NOW)).toEqual(dataset.seeds(NOW));
    }
  });

  it('keeps edited rows across deactivate → activate and bumps the revision', () => {
    const store = newStore();
    store.activate(NOW);
    store.updateField('kioskStatus', 0, 'pingStatus', 'failed');
    const before = store.getSnapshot();

    store.updateField('live', 0, 'message', 'Edited by hand');
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.datasets.live).not.toBe(before.datasets.live);
    expect(after.datasets.archive).toBe(before.datasets.archive);

    store.deactivate();
    expect(store.getSnapshot().active).toBe(false);
    expect(store.getSnapshot().datasets.kioskStatus[0]?.pingStatus).toBe('failed');

    store.activate(NOW);
    expect(store.getSnapshot().datasets.kioskStatus[0]?.pingStatus).toBe('failed');
  });

  it('keeps singleton datasets to exactly one row', () => {
    const store = newStore();
    store.activate(NOW);

    for (const datasetId of ['liveStatus', 'archiveState', 'kioskStatus']) {
      expect(rowsOf(store.getSnapshot(), datasetId)).toHaveLength(1);
      store.addRow(datasetId, NOW);
      expect(rowsOf(store.getSnapshot(), datasetId)).toHaveLength(1);
      store.removeRow(datasetId, 0);
      expect(rowsOf(store.getSnapshot(), datasetId)).toHaveLength(1);
    }
  });

  it('toggles, resets everything and switches the selected dataset', () => {
    const store = newStore();
    store.toggle(NOW);
    expect(store.getSnapshot().active).toBe(true);

    store.updateField('live', 0, 'message', 'CHANGED');
    store.resetAll(NOW);
    expect(store.getSnapshot().datasets.live[0]?.message).toBe(seeds('live')[0]?.message);
    expect(store.getSnapshot().active).toBe(true);

    store.selectDataset('archiveState');
    expect(store.getSnapshot().selectedDataset).toBe('archiveState');
    store.selectDataset('not-a-dataset');
    expect(store.getSnapshot().selectedDataset).toBe('archiveState');

    store.toggle(NOW);
    expect(store.getSnapshot().active).toBe(false);
  });
});

describe('fixture helpers', () => {
  it('formats local stamps the way the panel inputs round-trip them', () => {
    const date = new Date(2026, 0, 5, 7, 4, 9);
    expect(localStamp(date)).toBe('2026-01-05T07:04');
    expect(localDay(date)).toBe('2026-01-05');
    expect(localClock(date)).toBe('07:04:09');
  });

  it('reads text, numbers and booleans safely', () => {
    expect(readText(' KIOSK-001 ')).toBe('KIOSK-001');
    expect(readText(42)).toBe('42');
    expect(readText(null)).toBe('');
    expect(readNumber('12.5')).toBe(12.5);
    expect(readNumber('')).toBeNull();
    expect(readNumber(Number.NaN)).toBeNull();
    expect(readBoolean(true)).toBe(true);
    expect(readBoolean('true')).toBe(true);
    expect(readBoolean(1)).toBe(false);
  });

  it('maps a row to the FeedEntry shape with safe fallbacks', () => {
    const entry = toFeedEntry({
      id: 'e1',
      kind: 'heartbeat',
      kioskId: '',
      timestamp: '2026-11-13T20:30',
      message: ' Heartbeat from KIOSK-001 ',
      meterVolume: null,
    });

    expect(entry.id).toBe('e1');
    expect(entry.kind).toBe('heartbeat');
    expect(entry.kioskId).toBeNull();
    expect(entry.timestamp).toBe(new Date(2026, 10, 13, 20, 30).toISOString());
    expect(entry.message).toBe('Heartbeat from KIOSK-001');
    expect(entry.meterVolume).toBeNull();
  });

  it('clamps an unknown kind and an unreadable timestamp', () => {
    const entry = toFeedEntry({ kind: 'nonsense', timestamp: 'not-a-date', message: 'x' });
    expect(entry.kind).toBe('log');
    expect(entry.timestamp).toBe('');
  });
});

describe('live feed adapter', () => {
  it('maps the seeded rows to a live slice, newest first', () => {
    const live = selectLiveFeed(seeds('live'), seeds('liveStatus')[0]);

    expect(live.entries).toHaveLength(12);
    expect(live.status).toBe('open');
    expect(live.received).toBe(128);
    expect(live.entries[0]?.timestamp).toBe(new Date(2026, 10, 13, 20, 30).toISOString());
    expect(live.entries[11]?.timestamp).toBe(new Date(2026, 10, 13, 20, 19).toISOString());
    expect(live.entries[0]?.kind).toBe('heartbeat');
    expect(live.entries[1]?.kind).toBe('log');
    expect(live.entries[1]?.meterVolume).toBe(1237);
  });

  it('supports every chip state and a healthy fallback', () => {
    for (const status of ['idle', 'connecting', 'open', 'reconnecting'] as const) {
      expect(selectLiveFeed([], { status, received: 0 }).status).toBe(status);
    }
    const fallback = selectLiveFeed(seeds('live'), undefined);
    expect(fallback.status).toBe('idle');
    expect(fallback.received).toBe(12);
    expect(selectLiveFeed([], { status: 'nonsense', received: -4 })).toEqual({
      entries: [],
      status: 'idle',
      received: 0,
    });
    expect(selectLiveFeed([], { status: 'open', received: '300' }).received).toBe(300);
  });

  it('renders the empty state inputs when every row is removed', () => {
    const live = selectLiveFeed([], { status: 'open', received: 0 });
    expect(live.entries).toHaveLength(0);
    expect(live.status).toBe('open');
  });
});

describe('archive feed adapter', () => {
  it('never reports another page, even when the panel asks for one', () => {
    const rows = seeds('archive');
    const state = { status: 'idle', error: '', hasMore: true, loadedOnce: true };
    const archive = selectArchiveFeed(rows, state);

    expect(archive.entries).toHaveLength(9);
    expect(archive.hasMore).toBe(false);
    expect(archive.cursor).toBeNull();
    expect(archive.status).toBe('idle');
    expect(archive.error).toBeNull();
    expect(archive.loadedOnce).toBe(true);
    // The oldest seeded row sits last, matching the real append-only list.
    expect(archive.entries[0]?.id).toBe('mock-archive-01');
  });

  it('drives the error banner, the loading line and the empty state', () => {
    const failed = selectArchiveFeed([], {
      status: 'error',
      error: 'Could not load older entries.',
      loadedOnce: true,
    });
    expect(failed.status).toBe('error');
    expect(failed.error).toBe('Could not load older entries.');
    expect(failed.entries).toHaveLength(0);

    expect(selectArchiveFeed([], { status: 'error', error: '' }).error).toBeNull();
    expect(selectArchiveFeed([], { status: 'loading' }).status).toBe('loading');
    expect(selectArchiveFeed([], { status: 'nonsense' }).status).toBe('idle');

    const empty = selectArchiveFeed([], { status: 'idle', loadedOnce: true });
    expect(empty.entries).toHaveLength(0);
    expect(empty.loadedOnce).toBe(true);
    expect(selectArchiveFeed([], { status: 'idle' }).loadedOnce).toBe(false);
  });
});

describe('kiosk status adapter', () => {
  it('maps the singleton row used by the pill, card and device list', () => {
    const status = selectKioskStatus(seeds('kioskStatus')[0]);

    expect(status?.kioskId).toBe('KIOSK-001');
    expect(status?.browserOnline).toBe(true);
    expect(status?.connection).toBe('connected');
    expect(status?.pingStatus).toBe('ok');
    expect(status?.lastPingTime).toBe(localClock(NOW));
    expect(selectKioskStatus(undefined)).toBeNull();
  });

  it('supports the offline/checking states and clamps bad values', () => {
    const offline = selectKioskStatus({
      kioskId: 'KIOSK-999',
      browserOnline: false,
      connection: 'dropped',
      pingStatus: 'failed',
      lastPingTime: '',
    });
    expect(offline).toEqual({
      kioskId: 'KIOSK-999',
      browserOnline: false,
      connection: 'dropped',
      pingStatus: 'failed',
      lastPingTime: null,
    });

    const clamped = selectKioskStatus({ connection: 'nonsense', pingStatus: 'nonsense' });
    expect(clamped?.connection).toBe('connected');
    expect(clamped?.pingStatus).toBe('idle');
    expect(clamped?.browserOnline).toBe(false);
    expect(clamped?.kioskId).toBe('');
  });
});

describe('dataset definitions', () => {
  it('covers every surface with the expected ids and row counts', () => {
    expect(MOCK_DATASETS.map((dataset) => dataset.id)).toEqual([
      'live',
      'liveStatus',
      'archive',
      'archiveState',
      'kioskStatus',
    ]);
    expect(seeds('live')).toHaveLength(12);
    expect(seeds('archive')).toHaveLength(9);
    expect(MOCK_DATASETS.filter((dataset) => dataset.singleton)).toHaveLength(3);
    // The mocked archive starts terminal: the sentinel can never fire a request.
    expect(seeds('archiveState')[0]?.hasMore).toBe(false);
    expect(seeds('archiveState')[0]?.status).toBe('idle');
  });

  it('gives every seeded row a unique id inside its dataset', () => {
    for (const dataset of MOCK_DATASETS) {
      const ids = dataset.seeds(NOW).map((row) => readText(row.id ?? ''));
      if (dataset.singleton) continue;
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).not.toBe('');
    }
  });

  it('validates the rows the panel can produce', () => {
    const live = byId.get('live');
    const liveRow = live?.makeRow({ now: NOW, index: 0 }) ?? {};
    expect(live?.validate?.(liveRow)).toBeNull();
    expect(live?.validate?.({ ...liveRow, message: '' })).toBe('A live event needs a message.');
    expect(live?.validate?.({ ...liveRow, timestamp: '' })).toBe('Timestamp is required.');

    const liveStatus = byId.get('liveStatus');
    const statusRow = liveStatus?.makeRow({ now: NOW, index: 0 }) ?? {};
    expect(liveStatus?.validate?.(statusRow)).toBeNull();
    expect(liveStatus?.validate?.({ ...statusRow, received: -1 })).toBe(
      'Events received must be 0 or more.'
    );
  });
});

describe('mock orb, banner and panel markup', () => {
  function panelSnapshot(selectedDataset?: string): MockSnapshot {
    const store = newStore();
    store.activate(NOW);
    const snapshot = store.getSnapshot();
    return selectedDataset ? { ...snapshot, selectedDataset } : snapshot;
  }

  function renderPanel(snapshot: MockSnapshot): string {
    return renderToStaticMarkup(
      createElement(MockPanel, {
        snapshot,
        datasets: MOCK_DATASETS,
        onToggle: noop,
        onSelectDataset: noop,
        onAddRow: noop,
        onRemoveRow: noop,
        onChangeField: noop,
        onResetDataset: noop,
        onResetAll: noop,
        onClose: noop,
      })
    );
  }

  it('renders an accessible orb in both states', () => {
    const idle = renderToStaticMarkup(
      createElement(MockOrb, { active: false, expanded: false, onOpen: noop })
    );
    expect(idle).toContain('type="button"');
    expect(idle).toContain('class="mock-orb"');
    expect(idle).toContain('aria-label="Mock data"');
    expect(idle).toContain('aria-haspopup="dialog"');
    expect(idle).toContain('aria-expanded="false"');
    expect(idle).toContain('mock-orb-halo');
    expect(idle).toContain('mock-orb-ball');
    expect(idle).toContain('visually-hidden');
    expect(idle).not.toContain('mock-orb-active');

    const active = renderToStaticMarkup(
      createElement(MockOrb, { active: true, expanded: true, onOpen: noop })
    );
    expect(active).toContain('mock-orb-active');
    expect(active).toContain('aria-expanded="true"');
  });

  it('keeps the mock banner hidden unless fixtures are on', () => {
    expect(
      renderToStaticMarkup(createElement(MockBanner, { active: false, datasetCount: 0, onOpen: noop }))
    ).toBe('');

    const banner = renderToStaticMarkup(
      createElement(MockBanner, { active: true, datasetCount: 3, onOpen: noop })
    );
    expect(banner).toContain('class="mock-banner"');
    expect(banner).toContain('Mock data active');
    expect(banner).toContain('3 datasets');
  });

  it('lists the datasets and their rows with the master switch on', () => {
    const html = renderPanel(panelSnapshot());

    expect(html).toContain('id="mock-title"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Mock data on');
    expect(html).toContain('Fixtures are live');
    expect(html).toContain('Live feed entries');
    expect(html).toContain('Archive entries');
    expect(html).toContain('Kiosk status');
    expect(html).toContain('mock-nav-item mock-nav-item-active');
    expect(html).toContain('Add row');
    expect(html).toContain('Reset dataset');
    expect(html).toContain('Reset all');
    expect(html).toContain('24 rows across 5 of 5 datasets');
    // Identity fields are shown but locked, and the meter volume is numeric.
    expect(html).toContain('id="mock-live-0-id"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain('id="mock-live-0-meterVolume"');
    expect(html).toContain('type="number"');
    expect(html).toContain('type="datetime-local"');
  });

  it('renders the server snapshot as the empty "off" state', () => {
    const html = renderPanel(newStore().getServerSnapshot());

    expect(html).toContain('Mock data off');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('not shown yet');
    expect(html).toContain('No rows yet');
    expect(html).toContain('0 rows across 0 of 5 datasets');
  });

  it('hides add/remove for a singleton and shows its switches', () => {
    const html = renderPanel(panelSnapshot('archiveState'));

    expect(html).toContain('Archive state');
    expect(html).toContain('Has more pages');
    expect(html).toContain('Loaded once');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('Add row');
  });
});
