/**
 * The headline figures.
 *
 * The KPI module ships no React adapter, so this is one: mount the panel into
 * a host element once, push rows into it when the prop changes, destroy it on
 * the way out. It is about thirty lines, and every module in the package that
 * takes `(element, config)` would need the same thirty lines written again.
 *
 * The named reading beside the panel is a phrase rather than a figure, so it
 * is ordinary React rather than a tile.
 */

import { useEffect, useRef } from 'react';
import { createKPI } from '../lattice.js';

/** A magnitude to one decimal place, or a dash when there is none. */
function magText(value) {
  return typeof value === 'number' ? value.toFixed(1) : '-';
}

/** Name the largest earthquake in view. */
function largestOf(rows) {
  let biggest = null;
  for (const row of rows) {
    if (typeof row.mag !== 'number') continue;
    if (!biggest || row.mag > biggest.mag) biggest = row;
  }
  return biggest;
}

/**
 * @param {object} props
 * @param {object[]} props.rows the earthquakes the table currently matches
 * @param {object[]} props.tiles the tile specifications, a stable reference
 * @param {(kpi: object|null) => void} [props.onPanel]
 */
export function KpiStrip({ rows, tiles, onPanel }) {
  const host = useRef(null);
  const panel = useRef(null);
  const announce = useRef(onPanel);
  announce.current = onPanel;

  /* The rows at the moment of mounting, read through a ref so that changing
     them does not rebuild the panel. */
  const latest = useRef(rows);
  latest.current = rows;

  useEffect(() => {
    const made = createKPI(host.current, {
      rows: latest.current,
      rowKey: 'id',
      columns: 5,
      ariaLabel: 'Headline figures',
      tiles,
    });
    panel.current = made;
    if (announce.current) announce.current(made);
    return () => {
      panel.current = null;
      if (announce.current) announce.current(null);
      made.destroy();
    };
  }, [tiles]);

  /*
   * The panel does not follow the table's filters by itself, so the host hands
   * it the matched rows: without this the tiles would keep reporting the whole
   * window while the table showed a narrowed set.
   */
  useEffect(() => {
    if (panel.current) panel.current.setRows(rows);
  }, [rows]);

  const biggest = largestOf(rows);

  return (
    <section className="kpi-strip" aria-label="Headline figures">
      <div className="kpi-panel" ref={host} />
      <div className="kpi-named">
        <div className="kpi-named-value">
          {biggest ? `M${magText(biggest.mag)} ${biggest.place}` : 'No data'}
        </div>
        <div className="kpi-named-label">
          {biggest
            ? `Largest in view, ${new Date(biggest.time).toLocaleString('en-GB')}`
            : 'Largest earthquake in view'}
        </div>
      </div>
    </section>
  );
}
