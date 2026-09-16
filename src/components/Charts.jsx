/**
 * The four charts.
 *
 * The charts module ships no React adapter either, and unlike the KPI panel a
 * chart is not built from rows: it is built against a grid, which it follows.
 * So this component cannot mount until the grid exists, and it has to be told
 * when the grid is replaced. That is the whole reason `EarthquakeGrid`
 * republishes its instance as a callback: a chart's dependency is an object
 * that appears some time after the first render.
 *
 * `grid` in the dependency list is what makes the charts correct across an
 * unmount and remount: a new grid tears the old charts down and builds them
 * against the new one, in that order, so no chart is ever left holding a
 * destroyed grid.
 */

import { useEffect, useRef, useState } from 'react';
import { createChart } from '../lattice.js';

/**
 * @param {object} props
 * @param {object|null} props.grid the grid the charts read
 * @param {object[]} props.specs the chart specifications, a stable reference
 * @param {(charts: object[]) => void} [props.onCharts]
 */
export function Charts({ grid, specs, onCharts }) {
  const boxes = useRef([]);
  const [failures, setFailures] = useState({});
  const announce = useRef(onCharts);
  announce.current = onCharts;

  useEffect(() => {
    if (!grid) {
      if (announce.current) announce.current([]);
      return undefined;
    }
    const made = [];
    const broke = {};
    specs.forEach((spec, index) => {
      const container = boxes.current[index];
      if (!container) return;
      try {
        made.push(createChart({ grid, container, ...spec }));
      } catch (error) {
        broke[index] = error.message;
        console.error('[earthquake demo] chart', spec.type, error);
      }
    });
    setFailures(broke);
    if (announce.current) announce.current(made);

    return () => {
      if (announce.current) announce.current([]);
      for (const chart of made) chart.destroy();
    };
  }, [grid, specs]);

  return (
    <section className="chart-wrap" aria-label="Charts">
      {specs.map((spec, index) => (
        <div className="chart-box" key={spec.title}>
          {/* The chart draws into its own element rather than into the box, so
              React never has to reconcile a subtree it did not create. */}
          <div
            className="chart-mount"
            hidden={Boolean(failures[index])}
            ref={(node) => {
              boxes.current[index] = node;
            }}
          />
          {failures[index] ? (
            <p className="chart-error">{`This chart could not be drawn: ${failures[index]}`}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
