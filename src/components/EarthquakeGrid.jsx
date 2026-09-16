/**
 * One earthquake table.
 *
 * This is the whole of what wrapping the grid in React costs: the shipped
 * adapter is the component, and this adds the two things it has no prop for.
 *
 *   `onGrid`   hands the live grid instance to whoever needs to talk to it
 *              imperatively — the data router, which attaches to a grid, and
 *              the charts, which are built against one. The adapter exposes
 *              the instance through a forwarded ref, which is the right shape
 *              for a parent that reaches down on an event but the wrong one
 *              for a parent that has to react to the instance appearing, so it
 *              is republished here as a callback fired from an effect.
 *
 *   `notable`  the M4.5+ quick filter. It is a named row predicate, which the
 *              adapter has no prop for: its `filters` prop maps to
 *              `filters.set`, and that replaces the whole condition tree, so
 *              using it here would silently throw away any filter the reader
 *              had set in the tool panel. `filters.where` composes instead,
 *              which is what this needs, so the prop is translated to a call.
 *
 * Both are prop changes driving an existing grid through its own API. Neither
 * re-creates it: the adapter builds the grid once, in an effect with an empty
 * dependency list, and only ever pushes changes into it afterwards.
 */

import { useEffect, useRef } from 'react';
import { LatticeGrid } from '../lattice.js';
import { NOTABLE_MAG } from '../usgs-feed.js';

/** The M4.5+ predicate. Hoisted, so registering it twice registers the same one. */
const isNotable = (row) => typeof row.mag === 'number' && row.mag >= NOTABLE_MAG;

/**
 * @param {object} props
 * @param {object} props.config the grid config, which must be a stable reference
 * @param {(grid: object|null) => void} [props.onGrid] told when the grid appears and goes
 * @param {boolean} [props.notable] narrow to M4.5 and above
 * @param {string} [props.className] applied to the host element, not the grid
 */
export function EarthquakeGrid({ config, onGrid, notable = false, className }) {
  const handle = useRef(null);
  const announce = useRef(onGrid);
  announce.current = onGrid;

  /*
   * The adapter's own effect runs first, because it belongs to the child, and
   * React runs a child's effects before its parent's. So by the time this
   * runs the grid exists; and on the way out this runs before the adapter
   * destroys it, so whoever was told about the grid lets go of it while it is
   * still a valid object.
   */
  useEffect(() => {
    const grid = handle.current ? handle.current.grid : null;
    if (!grid) return undefined;
    if (announce.current) announce.current(grid);
    return () => {
      if (announce.current) announce.current(null);
    };
  }, []);

  useEffect(() => {
    const grid = handle.current ? handle.current.grid : null;
    if (!grid) return undefined;
    /* Registering is activating, and removing by name leaves any other filter
       the reader has set untouched. */
    grid.filters.where('notable', notable ? isNotable : null);
    return undefined;
  }, [notable]);

  return <LatticeGrid ref={handle} className={className} {...config} />;
}
