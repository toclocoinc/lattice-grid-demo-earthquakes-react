/**
 * The one place this application touches the grid package.
 *
 * Everything else imports from here, so there is exactly one copy of the grid
 * on the page and exactly one React component wrapping it. Two copies keep
 * separate renderer registries and a renderer registered through one is
 * invisible to the other, which is the failure this file exists to prevent.
 *
 * The React component is the one the package ships: `createLatticeGrid` is a
 * factory rather than a component precisely so that React and `createGrid` are
 * passed in, and the adapter carries no second copy of either.
 */

import React from 'react';
import { createGrid, setLicence, getVersion } from '@toclocoinc/lattice-grid';
import { createLatticeGrid } from '@toclocoinc/lattice-grid/modules/react';

export { createChart } from '@toclocoinc/lattice-grid/modules/charts';
export { createKPI } from '@toclocoinc/lattice-grid/modules/kpi';
export { createDataRouter } from '@toclocoinc/lattice-grid/modules/data-router';
export { setLicence, getVersion };

/**
 * A ledger of grid instances: how many have ever been built, how many have
 * been torn down, and which are alive right now.
 *
 * This is the point of the React edition, so the page keeps the count rather
 * than leaving it to be guessed at. React's StrictMode deliberately mounts
 * every component twice in development to flush out effects that do not clean
 * up after themselves; a grid is an expensive, DOM-owning object, and "exactly
 * one survived" is a claim worth being able to read off the page instead of
 * inferring from how it looks.
 *
 * It is also what the deployment check reads.
 */
export const lifecycle = {
  /** How many grids `createGrid` has been asked for. */
  created: 0,
  /** How many have been destroyed. */
  destroyed: 0,
  /** How many times a prop change was pushed into a live grid as a reconfigure. */
  reconfigured: 0,
  /** The grids that are alive now. */
  live: new Set(),
};

/**
 * `createGrid`, with the ledger wrapped around it.
 *
 * The adapter calls this instead of the bare factory. It changes nothing about
 * the grid: it counts the call, remembers the instance, and replaces
 * `destroy` with one that forgets it again. `setAll` is counted too, because
 * that is the single path every prop change takes through the adapter, so a
 * count of zero across a re-render is proof the re-render cost the grid
 * nothing.
 */
function countedCreateGrid(element, config) {
  const grid = createGrid(element, config);
  lifecycle.created += 1;
  lifecycle.live.add(grid);

  const destroy = grid.destroy.bind(grid);
  grid.destroy = () => {
    lifecycle.destroyed += 1;
    lifecycle.live.delete(grid);
    return destroy();
  };

  const setAll = grid.setAll.bind(grid);
  grid.setAll = (next) => {
    lifecycle.reconfigured += 1;
    return setAll(next);
  };

  return grid;
}

/**
 * The grid, as a React component.
 *
 * Built once, at module scope. Building it inside a component would hand React
 * a new component type on every render, and a new type is a different element:
 * React would unmount the old subtree and mount a fresh one, destroying and
 * rebuilding the grid on every keystroke.
 */
export const LatticeGrid = createLatticeGrid({ React, createGrid: countedCreateGrid });
