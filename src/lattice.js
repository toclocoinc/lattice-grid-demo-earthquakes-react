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
import ReactDOM from 'react-dom';
import { createGrid, setLicence, getVersion } from '@toclocoinc/lattice-grid';
import { createChart } from '@toclocoinc/lattice-grid/modules/charts';
import { createKPI } from '@toclocoinc/lattice-grid/modules/kpi';
import { createTabs } from '@toclocoinc/lattice-grid/modules/tabs';
import { createDataRouter } from '@toclocoinc/lattice-grid/modules/data-router';
import { createLatticeReact } from '@toclocoinc/lattice-grid/modules/react';

export { createChart, createKPI, createDataRouter, setLicence, getVersion };

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
 * Every Lattice binding this page uses, as React components and hooks.
 *
 * Built once, at module scope. Building them inside a component would hand
 * React a new component type on every render, and a new type is a different
 * element: React would unmount the old subtree and mount a fresh one,
 * destroying and rebuilding the grid on every keystroke.
 *
 * ## What changed in 1.63
 *
 * This page used to write its own React wrapper for the KPI panel, for the
 * charts and for the tab strip, because the adapter wrapped `createGrid` and
 * nothing else — about three hundred lines of `useEffect`, and a hand-written
 * tablist because the tabs module builds its tabs' grids itself. The adapter
 * now covers every viewer, so all of that is deleted and this is the whole of
 * what wiring Lattice into React costs.
 *
 * `createGrid` is the counted one above, so the ledger still sees every grid
 * the adapter builds — which is what the deployment check reads.
 */
const lattice = createLatticeReact({
  React,
  ReactDOM,
  createGrid: countedCreateGrid,
  createKPI,
  createChart,
  createTabs,
  createDataRouter,
});

export const {
  LatticeGrid,
  LatticeKPI,
  LatticeChart,
  LatticeTabs,
  LatticeGridProvider,
  useLatticeGrid,
} = lattice;
