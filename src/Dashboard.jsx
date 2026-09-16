/**
 * The dashboard: the page once the earthquakes have arrived.
 *
 * React owns the page; Lattice owns the grid. Everything that is a view — the
 * masthead, the tab strip, the controls, which table is on screen, whether the
 * M4.5+ narrowing is on — is React state. Everything that is the table itself
 * is the grid's, reached through props on the way in and through its own API
 * for the handful of things props cannot express.
 *
 * Nothing on this page is ever re-created to reflect a change. The grids are
 * built once, the charts once per grid, the KPI panel once; every change after
 * that is pushed into the thing that already exists.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Charts } from './components/Charts.jsx';
import { Controls } from './components/Controls.jsx';
import { EarthquakeGrid } from './components/EarthquakeGrid.jsx';
import { Footer } from './components/Footer.jsx';
import { KpiStrip } from './components/KpiStrip.jsx';
import { Masthead } from './components/Masthead.jsx';
import { Tabs } from './components/Tabs.jsx';
import {
  ALL_GRID_PROPS,
  CHART_SPECS,
  SIGNIFICANT_GRID_PROPS,
  quakeTiles,
} from './grid-config.js';
import { lifecycle } from './lattice.js';
import { useMatchedRows } from './hooks/useMatchedRows.js';
import { useQuakeFeed } from './hooks/useQuakeFeed.js';
import { useQuakeRouter } from './hooks/useQuakeRouter.js';

const TABS = [
  { id: 'all', label: 'All earthquakes' },
  { id: 'significant', label: 'Significant' },
];

export function Dashboard({ rows, replayRows, meta, significantIds, mode, fetchMs }) {
  const {
    router,
    store,
    status,
    statusRef,
    ingest,
    pruneWindow,
    attachAll,
    attachSignificant,
    notePoll,
    notePollError,
    pruneTick,
  } = useQuakeRouter({ initialRows: rows });

  const [allGrid, setAllGrid] = useState(null);
  const [significantGrid, setSignificantGrid] = useState(null);
  const [charts, setCharts] = useState([]);
  const [kpi, setKpi] = useState(null);
  const [active, setActive] = useState('all');
  const [notable, setNotable] = useState(false);

  /* The router is handed each grid as it appears, and lets go of it before
     React destroys it. */
  useEffect(() => (allGrid && router ? attachAll(allGrid) : undefined), [allGrid, router, attachAll]);
  useEffect(
    () => (significantGrid && router ? attachSignificant(significantGrid) : undefined),
    [significantGrid, router, attachSignificant],
  );

  /* One of the tiles reports how long ago the feed answered, which is not a
     property of any row, so it reads the live counters through a getter. The
     getter never changes, so the tile list never does either, so the panel is
     never rebuilt. */
  const tiles = useMemo(() => quakeTiles(() => statusRef.current.lastPoll), [statusRef]);

  const inView = useMatchedRows(allGrid, pruneTick);

  /**
   * Take a poll's result: roll the window forward, then apply it.
   *
   * That is the right order on its own terms, and it also matters here: a row
   * the grid has removed stays in the rows it walks until the next change
   * reaches it, so doing the removals before the additions means the additions
   * settle it within the same poll rather than a minute later.
   */
  const onPoll = useCallback(
    (result) => {
      pruneWindow();
      ingest(result.rows);
      notePoll(result.fetchedAt);
    },
    [pruneWindow, ingest, notePoll],
  );

  const onReplayBatch = useCallback((batch) => ingest(batch), [ingest]);

  const { replaying } = useQuakeFeed({
    /* Started only once the router exists and the table is there to receive
       what arrives. */
    enabled: Boolean(router && allGrid),
    live: mode === 'live' && meta.live,
    replayRows,
    significantIds,
    onPoll,
    onPollError: notePollError,
    onReplayBatch,
  });

  /* The significant count is read from what the page holds rather than from
     the second table, so the badge is right before that table has ever been
     built. */
  let significantHeld = 0;
  for (const row of store.values()) if (row.significant) significantHeld += 1;

  const tabs = useMemo(
    () => [
      { ...TABS[0], badge: inView.length },
      { ...TABS[1], badge: significantHeld },
    ],
    [inView.length, significantHeld],
  );

  /* A hook for the verification script and for anyone poking at the page. It
     holds live references rather than copies: the significant table is only
     created when its tab is first opened, and a copy taken now would never
     see it. */
  useEffect(() => {
    window.__quakeDemo = {
      ready: true,
      error: null,
      allGrid,
      significantGrid,
      router,
      charts,
      kpi,
      store,
      meta,
      status,
      lifecycle,
      ingest,
      pruneWindow,
      setActiveTab: setActive,
      setNotable,
      notable,
      activeTab: active,
      timings: { mode: replaying ? 'replay' : mode, fellBack: !!meta.fellBack, fetchMs },
    };
  }, [
    allGrid, significantGrid, router, charts, kpi, store, meta, status,
    ingest, pruneWindow, active, notable, replaying, mode, fetchMs,
  ]);

  return (
    <>
      <Masthead meta={meta} status={status} replaying={replaying} />
      <KpiStrip rows={inView} tiles={tiles} onPanel={setKpi} />
      <Charts grid={allGrid} specs={CHART_SPECS} onCharts={setCharts} />
      <Controls
        grid={allGrid}
        notable={notable}
        onNotable={setNotable}
        hidden={active !== 'all'}
      />
      <Tabs tabs={tabs} active={active} onChange={setActive} ariaLabel="Earthquake views">
        {(id) =>
          id === 'all' ? (
            <EarthquakeGrid
              config={ALL_GRID_PROPS}
              onGrid={setAllGrid}
              notable={notable}
              className="grid-host"
            />
          ) : (
            /*
             * A second dataset, not a filter over the first. The significant
             * feed reaches back a month, so it holds events the seven day
             * window has already dropped; narrowing the All table could never
             * show them. It therefore has no rolling window of its own.
             */
            <EarthquakeGrid
              config={SIGNIFICANT_GRID_PROPS}
              onGrid={setSignificantGrid}
              className="grid-host"
            />
          )
        }
      </Tabs>
      <Footer />
    </>
  );
}
