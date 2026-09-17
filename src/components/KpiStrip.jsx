/**
 * The headline figures.
 *
 * This was thirty lines of `useEffect` — create the panel, bind it to the
 * table, refresh it on a timer, destroy it on the way out — because the KPI
 * module shipped no React adapter. Since 1.63 it does, so the panel is a
 * component and the only thing left here is the part that is genuinely this
 * page's: the named reading beside the tiles, which is a phrase rather than a
 * figure and therefore ordinary React.
 *
 * The panel takes its grid from `<LatticeGridProvider>` — `gridName="all"` is
 * the table this page published under that name — so it waits for the table to
 * exist and is built the moment it does. There is no instance to pass down and
 * nothing to re-publish as a callback.
 *
 * The panel is bound to the table, so it reads what the table currently matches
 * and follows it on its own: a filter, a grouping (the rows under a collapsed
 * heading included), an arrival, a revision and a removal all reach the tiles
 * with nothing pushed in from here. React never handles the rows.
 */

import { useEffect, useRef, useState } from 'react';
import { timeOf } from '../grid-config.js';
import { LatticeKPI } from '../lattice.js';

/* Two of the tiles are about elapsed time, so they move on their own: the
   panel is asked to re-read the table this often. */
const REFRESH_EVERY_MS = 15000;

/** A magnitude to one decimal place, or a dash when there is none. */
function magText(value) {
  return typeof value === 'number' ? value.toFixed(1) : '-';
}

/** The largest earthquake among the panel's rows, or null when it holds none. */
function largestOf(panel) {
  let biggest = null;
  panel.rows.forEach((row) => {
    if (typeof row.mag !== 'number') return;
    if (!biggest || row.mag > biggest.mag) biggest = row;
  });
  return biggest;
}

/**
 * @param {object} props
 * @param {object[]} props.tiles the tile specifications, a stable reference
 * @param {(kpi: object|null) => void} [props.onPanel]
 */
export function KpiStrip({ tiles, onPanel }) {
  const [panel, setPanel] = useState(null);
  const [biggest, setBiggest] = useState(null);
  const announce = useRef(onPanel);
  announce.current = onPanel;

  /* The clock and the named reading both belong to the panel instance, so they
     are set up when it arrives and torn down when it goes. `onReady`/`onDestroy`
     are the adapter's own lifecycle callbacks; nothing here creates or destroys
     the panel. */
  useEffect(() => {
    if (!panel) {
      setBiggest(null);
      if (announce.current) announce.current(null);
      return undefined;
    }
    const name = () => setBiggest(largestOf(panel));
    const stop = panel.on('change', name);
    name();
    const clock = setInterval(() => panel.refresh(), REFRESH_EVERY_MS);
    if (announce.current) announce.current(panel);
    return () => {
      clearInterval(clock);
      stop();
    };
  }, [panel]);

  return (
    <section className="kpi-strip" aria-label="Headline figures">
      <LatticeKPI
        className="kpi-panel"
        gridName="all"
        rowKey="id"
        /* The columns the custom tiles and the named reading need on each
           projected row. `mag` is declared by the largest tile as well; the
           other two are declared by nothing else, so without this they would
           not be there to read. */
        fields={['mag', 'place', 'time']}
        columns={5}
        ariaLabel="Headline figures"
        tiles={tiles}
        onReady={setPanel}
        onDestroy={() => setPanel(null)}
      />
      <div className="kpi-named">
        <div className="kpi-named-value">
          {biggest ? `M${magText(biggest.mag)} ${biggest.place}` : 'No data'}
        </div>
        <div className="kpi-named-label">
          {biggest
            ? `Largest in view, ${new Date(timeOf(biggest)).toLocaleString('en-GB')}`
            : 'Largest earthquake in view'}
        </div>
      </div>
    </section>
  );
}
