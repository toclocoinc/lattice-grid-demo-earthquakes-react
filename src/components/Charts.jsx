/**
 * The four charts.
 *
 * This was another `useEffect` — build a chart per spec against the grid, catch
 * the ones that throw, destroy them all on the way out, and re-do the lot
 * whenever the grid was replaced. Since 1.63 a chart is a component, so each
 * one is an element in a list and React does the rest.
 *
 * A chart is built *against a grid*, and the grid does not exist on the first
 * render. `<LatticeChart>` waits for it: it takes the table published under
 * `gridName` and mounts the moment that table appears, then rebuilds itself
 * against a new table if one ever replaces it — in that order, so no chart is
 * ever left holding a destroyed grid.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LatticeChart } from '../lattice.js';

/**
 * @param {object} props
 * @param {object[]} props.specs the chart specifications, a stable reference
 * @param {(charts: object[]) => void} [props.onCharts]
 */
export function Charts({ specs, onCharts }) {
  /* The live chart instances, by title, for the page's own inspection hook.
     Held in state because the deployment check reads them off `window` and has
     to see them arrive. */
  const [made, setMade] = useState({});
  const announce = useRef(onCharts);
  announce.current = onCharts;

  const remember = useCallback((title, chart) => {
    setMade((held) => {
      if (held[title] === chart) return held;
      const next = { ...held };
      if (chart) next[title] = chart; else delete next[title];
      return next;
    });
  }, []);

  useEffect(() => {
    if (announce.current) announce.current(specs.map((s) => made[s.title]).filter(Boolean));
  }, [made, specs]);

  return (
    <section className="chart-wrap" aria-label="Charts">
      {specs.map((spec) => (
        <div className="chart-box" key={spec.title}>
          {/* The chart draws into its own element rather than into the box, so
              React never has to reconcile a subtree it did not create. */}
          <LatticeChart
            className="chart-mount"
            gridName="all"
            {...spec}
            onReady={(chart) => remember(spec.title, chart)}
            onDestroy={() => remember(spec.title, null)}
          />
        </div>
      ))}
    </section>
  );
}
