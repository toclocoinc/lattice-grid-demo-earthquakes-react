/**
 * The headline figures.
 *
 * The KPI module ships no React adapter, so this is one: bind the panel to
 * the table once the table exists, destroy it on the way out. It is about
 * thirty lines, and every module in the package that takes `(element, config)`
 * would need the same thirty lines written again.
 *
 * The panel is bound to the grid, so it reads what the table currently
 * matches and follows it on its own: a filter, a grouping (the rows under a
 * collapsed heading included), an arrival, a revision and a removal all reach
 * the tiles with nothing pushed in from here. React never handles the rows.
 *
 * The named reading beside the panel is a phrase rather than a figure, so it
 * is ordinary React rather than a tile. It is read from the panel's own rows
 * each time the panel says it has re-read the table.
 */

import { useEffect, useRef, useState } from 'react';
import { timeOf } from '../grid-config.js';
import { createKPI } from '../lattice.js';

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
 * @param {object|null} props.grid the table the panel is bound to
 * @param {object[]} props.tiles the tile specifications, a stable reference
 * @param {(kpi: object|null) => void} [props.onPanel]
 */
export function KpiStrip({ grid, tiles, onPanel }) {
  const host = useRef(null);
  const announce = useRef(onPanel);
  announce.current = onPanel;
  const [biggest, setBiggest] = useState(null);

  useEffect(() => {
    if (!grid) {
      setBiggest(null);
      return undefined;
    }
    const made = createKPI(host.current, {
      grid,
      rowKey: 'id',
      /* The columns the custom tiles and the named reading need on each
         projected row. `mag` is declared by the largest tile as well; the
         other two are declared by nothing else, so without this they would
         not be there to read. */
      fields: ['mag', 'place', 'time'],
      columns: 5,
      ariaLabel: 'Headline figures',
      tiles,
    });
    const name = () => setBiggest(largestOf(made));
    const stop = made.on('change', name);
    name();
    const clock = setInterval(() => made.refresh(), REFRESH_EVERY_MS);
    if (announce.current) announce.current(made);
    return () => {
      clearInterval(clock);
      stop();
      if (announce.current) announce.current(null);
      made.destroy();
    };
  }, [grid, tiles]);

  return (
    <section className="kpi-strip" aria-label="Headline figures">
      <div className="kpi-panel" ref={host} />
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
