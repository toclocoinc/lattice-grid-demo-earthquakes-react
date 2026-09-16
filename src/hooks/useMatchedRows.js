/**
 * What the table currently matches, as React state.
 *
 * The tiles and the named reading are fed the earthquakes the table matches
 * rather than being bound to the table, because a bound panel is handed a
 * projection of each row rather than the row itself, and a timestamp column
 * arrives in it already written out as text. Anything doing arithmetic on a
 * time then compares a string with a number, which is not an error in
 * JavaScript, just quietly false. These figures measure elapsed time, so they
 * are given the real rows.
 *
 * Two of the tiles are about elapsed time, so they move on their own: hence
 * the clock alongside the grid's own events.
 */

import { useEffect, useState } from 'react';

const RECOMPUTE_EVERY_MS = 15000;

/**
 * Every earthquake the grid currently matches, whether or not it is grouped.
 *
 * Walking the grid gives back what is on screen, and once the rows are grouped
 * that is a handful of headings rather than the earthquakes themselves. Taking
 * the leaves beneath each heading, keyed so an open group is not counted
 * twice, gives the same set in either arrangement.
 *
 * @param {object} grid the grid to read
 * @returns {object[]} the matched data rows
 */
export function matchedRows(grid) {
  if (!grid) return [];
  const seen = new Map();
  grid.rows.forEach((row) => {
    if (!row) return;
    if (row.group) {
      for (const leaf of grid.rows.leavesOf(row.key) || []) {
        if (leaf && leaf.data) seen.set(leaf.key, leaf.data);
      }
    } else if (row.data) {
      seen.set(row.key, row.data);
    }
  });
  return [...seen.values()];
}

/**
 * Follow a grid's matched rows.
 *
 * @param {object|null} grid
 * @param {number} [nudge] bump this to force a recount after a change the grid
 *   does not raise an event for, such as the window rolling forward
 * @returns {object[]}
 */
export function useMatchedRows(grid, nudge = 0) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!grid) {
      setRows([]);
      return undefined;
    }
    const recompute = () => setRows(matchedRows(grid));
    recompute();

    /* `on` hands back its own unsubscribe. Collecting them and calling every
       one is what makes an unmount leave no listener behind. */
    const off = [
      grid.on('filter:changed', recompute),
      grid.on('model:changed', recompute),
      grid.on('column:grouped', recompute),
    ];
    const clock = setInterval(recompute, RECOMPUTE_EVERY_MS);

    return () => {
      clearInterval(clock);
      for (const stop of off) stop();
    };
  }, [grid, nudge]);

  return rows;
}
