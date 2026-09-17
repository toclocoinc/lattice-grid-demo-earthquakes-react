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
 *
 * Since Lattice 1.63 none of that is written here. The adapter ships a
 * component for every viewer, so the page's own `EarthquakeGrid` wrapper and
 * the two mount effects inside `KpiStrip` and `Charts` are gone: a grid
 * publishes itself into `<LatticeGridProvider>` under a name, the panel and the
 * charts take it from there, and the M4.5+ narrowing is a `predicates` prop.
 *
 * The tab strip stays this page's own. The shipped module's tab descriptors are
 * read once, at mount, so a live badge count would freeze at whatever it was
 * when the strip was built — see the finding filed against BACKLOG-0001307.
 * `createLatticeTabs` renders React content into the module's panels correctly;
 * it is the badge that is not yet live, and the badge is the reason this page
 * has a tab strip at all.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Charts } from './components/Charts.jsx';
import { Controls } from './components/Controls.jsx';
import { Footer } from './components/Footer.jsx';
import { KpiStrip } from './components/KpiStrip.jsx';
import { Masthead } from './components/Masthead.jsx';
import {
  ALL_GRID_PROPS,
  CHART_SPECS,
  SIGNIFICANT_GRID_PROPS,
  quakeTiles,
} from './grid-config.js';
import { Tabs } from './components/Tabs.jsx';
import {
  lifecycle, LatticeGrid, LatticeGridProvider,
} from './lattice.js';
import { NOTABLE_MAG } from './usgs-feed.js';
import { useQuakeFeed } from './hooks/useQuakeFeed.js';
import { useQuakeRouter } from './hooks/useQuakeRouter.js';

const TABS = [
  { id: 'all', label: 'All earthquakes' },
  { id: 'significant', label: 'Significant' },
];

/**
 * The M4.5+ narrowing, as a named row predicate.
 *
 * Hoisted, so registering it twice registers the same one. It reaches the table
 * through the adapter's `predicates` prop, which maps to
 * `grid.filters.where(name, fn)` — a *named* predicate that composes with
 * whatever filter the reader has set in the tool panel. The `filters` prop
 * could not do this: it maps to `filters.set`, which replaces the whole
 * condition tree and would silently throw the reader's own filter away.
 */
const isNotable = (row) => typeof row.mag === 'number' && row.mag >= NOTABLE_MAG;
const NOTABLE_ON = Object.freeze({ notable: isNotable });
const NOTABLE_OFF = Object.freeze({});

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

  /* How many earthquakes the table currently matches, for the badge on its
     tab. The panel is bound to the table and follows it, so the number is
     read off the panel each time it says it has re-read the table, rather
     than counted here a second time. */
  const [inWindow, setInWindow] = useState(0);
  useEffect(() => {
    if (!kpi) {
      setInWindow(0);
      return undefined;
    }
    const read = () => {
      const n = kpi.value('events');
      setInWindow(typeof n === 'number' ? n : 0);
    };
    read();
    return kpi.on('change', read);
  }, [kpi]);

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

  /*
   * The shipped tab strip, with React elements as its content.
   *
   * The module owns the tablist, the keyboard handling, the lazy first mount
   * and the keep-once-opened rule; React owns what is inside each panel, so
   * each table is a real `<LatticeGrid>` with props, a name and the page's
   * context around it. A tab's content is not built until its tab is first
   * opened, which is also what makes the grid measure itself while on screen.
   */
  const tabs = useMemo(
    () => [
      { ...TABS[0], badge: inWindow },
      { ...TABS[1], badge: significantHeld },
    ],
    [inWindow, significantHeld],
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
    <LatticeGridProvider>
      <Masthead meta={meta} status={status} replaying={replaying} />
      <KpiStrip tiles={tiles} onPanel={setKpi} />
      <Charts specs={CHART_SPECS} onCharts={setCharts} />
      <Controls
        grid={allGrid}
        notable={notable}
        onNotable={setNotable}
        hidden={active !== 'all'}
      />
      <Tabs tabs={tabs} active={active} onChange={setActive} ariaLabel="Earthquake views">
        {(id) =>
          id === 'all' ? (
            <LatticeGrid
              name="all"
              className="grid-host"
              {...ALL_GRID_PROPS}
              predicates={notable ? NOTABLE_ON : NOTABLE_OFF}
              onGridReady={setAllGrid}
              onGridDestroy={() => setAllGrid(null)}
            />
          ) : (
            /*
             * A second dataset, not a filter over the first. The significant
             * feed reaches back a month, so it holds events the seven day
             * window has already dropped; narrowing the All table could never
             * show them. It therefore has no rolling window of its own.
             */
            <LatticeGrid
              name="significant"
              className="grid-host"
              {...SIGNIFICANT_GRID_PROPS}
              onGridReady={setSignificantGrid}
              onGridDestroy={() => setSignificantGrid(null)}
            />
          )
        }
      </Tabs>
      <Footer />
    </LatticeGridProvider>
  );
}
