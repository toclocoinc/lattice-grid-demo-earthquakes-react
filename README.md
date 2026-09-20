# Earthquakes around the world, in React

A live dashboard of worldwide earthquakes, built as a React application around Lattice Grid, reading the United States Geological Survey feeds directly from the browser.

**[See it running](https://toclocoinc.github.io/lattice-grid-demo-earthquakes-react/)**

| | |
| --- | --- |
| Grid on npm | [@toclocoinc/lattice-grid](https://www.npmjs.com/package/@toclocoinc/lattice-grid) |
| Grid repository | [toclocoinc/latticegrid](https://github.com/toclocoinc/latticegrid) |
| Product site | [latticegrid.dev](https://www.latticegrid.dev) |
| The same demo without a framework | [lattice-grid-demo-earthquakes](https://github.com/toclocoinc/lattice-grid-demo-earthquakes) |

This is the same dashboard as the plain-JavaScript edition, to the word and to the figure. The difference is entirely in how it is put together, which is the point: **React owns the page, Lattice owns the grid.**

## What it shows

Every earthquake USGS has recorded in the last seven days, one row each, updated each minute. Magnitudes and locations are revised for hours after an event, and a revision lands on the row it belongs to rather than adding a second one.

**The table.** When it happened in your own time zone and in UTC, the magnitude and how far it has been revised since it first arrived, the scale used, the place, the PAGER alert level, whether a tsunami was flagged, how many people reported feeling it, the depth and coordinates, which network recorded it, and a link to the USGS page. Sort, filter, group, search, and choose your columns.

**Headline figures.** How many earthquakes are in the window, the largest magnitude, how many were M4.5 and above in the last twenty four hours, how long since the latest one, and how long since the feed last answered. The strip is a KPI panel bound to the table (`createKPI(host, { grid })`), so it follows the table on its own — a filter, a grouping, an arrival, a removal — and React never handles the rows: narrow the table and every figure follows. The one figure that is not a tile is the named largest earthquake, a phrase rather than a number, drawn from the panel's own rows each time it re-reads the table. A bound panel hands a tile the grid's value for each column, and for a datetime column that is the grid's wall-clock text rather than the feed's number, so the two elapsed-time tiles read it back into an instant first.

**Charts.** How many earthquakes at each magnitude, how many were recorded each day, depth against magnitude, and which network recorded them. All four read the same rows as the table.

**Significant earthquakes.** A second table on its own tab, reading the month-long significant feed. It is a second dataset rather than a filter over the first, because it holds events the seven day window has already dropped.

## The integration pattern

The grid ships a React adapter, and this demo uses it as it is. The adapter is a factory rather than a component, because it imports neither React nor the grid: you pass both in, which is what stops a second copy of either ending up on the page.

```js
// src/lattice.js — the one place this application touches the grid package
import React from 'react';
import { createGrid } from '@toclocoinc/lattice-grid';
import { createLatticeGrid } from '@toclocoinc/lattice-grid/modules/react';

export const LatticeGrid = createLatticeGrid({ React, createGrid });
```

```jsx
<LatticeGrid columns={columns} rows={rows} rowKey="id" onCellChanged={fn} />
```

Five things make the difference between that working and that fighting you.

**Build the component once, at module scope.** `createLatticeGrid` returns a component *type*. Calling it inside a render hands React a new type every time, and a new type is a different element: React unmounts the old subtree and mounts a fresh one, so the grid is destroyed and rebuilt on every render.

**Hoist every config prop.** The adapter compares each prop with `Object.is` and pushes anything that differs into the live grid through `setAll`. A `columns` array built inside a component is a new array every render, so it never matches, and the grid is handed a full column reconfiguration each time an unrelated number on the page moves. In this demo the columns, the formatting rules, the chart specifications and both tables' complete props objects are built once in [`src/grid-config.js`](src/grid-config.js) and never rebuilt.

**Rows do not arrive as a prop.** `rows` is an ordinary config key, so setting it replaces the whole array. This is a live feed: an earthquake's magnitude is revised for hours after it is first reported, and the revision has to land on the row it belongs to — keeping its place, its selection and its flash — rather than repainting the table. So the tables mount empty and the data router fills them with keyed diffs. See [`src/hooks/useQuakeRouter.js`](src/hooks/useQuakeRouter.js).

**Anything with a `destroy` is created in an effect.** Not in a `useState` initialiser and not in a lazily-filled ref: React calls an initialiser more than once by design, and the copy it discards is never torn down. An effect is the only place in React that comes with a matching teardown.

**Props drive the grid; they never rebuild it.** The M4.5+ toggle is React state. It reaches the table as a prop on `<EarthquakeGrid>`, which translates it into `grid.filters.where('notable', …)` on the instance that is already there. The verification script proves the grid object is the same one before and after.

### Where React's lifecycle is actually tested

`React.StrictMode` is on. In development it mounts every component twice on purpose, which is the harshest test there is of a wrapper around something that owns DOM, timers and requests. The application keeps a ledger of every grid built and destroyed, and `tools/verify.mjs` reads it rather than judging by eye:

- the double mount builds the grid twice and destroys the first, leaving exactly one alive and exactly one `.lattice` root on the page;
- taking the whole application off the page and putting it back leaves no interval, no listener on `window` or `document`, no request in flight and no grid alive — measured across two identical cycles, so anything that accumulated would show as a difference;
- toggling the M4.5+ prop narrows the table, moves every figure and redraws the charts without building a single new grid.

## Running it

You need Node 22 or newer.

```
npm ci
npm run dev
```

Vite prints the address to open.

The page fetches from the USGS feeds as it loads. To open the saved copy instead, so the page works with no network at all, add `?source=snapshot` to the address. `?source=snapshot&replay=1` feeds the saved run in over time, so it moves offline too.

When the live feeds cannot be reached the page opens the saved copy by itself and says so at the top, rather than showing an error.

## Building and checking it

```
npm run build     # into dist/
npm run serve     # serve the built dist/
npm run verify    # drive the built site in a real browser
```

`npm run verify` is what gates the deployment. It runs the development server once for the React lifecycle proofs above, then serves the built `dist/` and checks the published artefact: the table holds rows, all four charts drew marks rather than empty axes, every headline figure agrees with the saved feed recomputed independently in Node, a revision lands on its own row, a stale revision does not undo a correction, the rolling window drops what has aged out, and the page logged no console error, no thrown error and no React warning.

To check this edition against the plain-JavaScript one, row for row and mark for mark:

```
node tools/verify.mjs --compare ../lattice-grid-demo-earthquakes
```

## The stack

Every version is pinned exactly, so `npm ci` installs the tree the demo was checked against rather than whatever is newest today.

| | |
| --- | --- |
| React | 18.3.1, with JSX and no TypeScript |
| Build | Vite 7.3.6, `@vitejs/plugin-react` 4.7.0 |
| Grid | `@toclocoinc/lattice-grid` 1.63.0, plus its React, charts, KPI and data-router modules |

## Where the data comes from

The [United States Geological Survey earthquake feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php), which are public, need no key, and are regenerated every minute. The page reads two of them:

- `all_week.geojson` — every earthquake recorded worldwide in the last seven days, which is the rolling window's content;
- `significant_month.geojson` — the significant earthquakes of the last month, which reaches further back than the week feed and so is kept as a second dataset.

Once running it polls `all_day.geojson` each minute. The day feed rather than the hour feed: an event is revised for hours after it first appears, as a human reviewer checks the magnitude and the place, and the hour feed would have dropped it long before that revision arrived.

**USGS data are in the public domain and free to use.** Times are shown in your own time zone alongside UTC, which is what USGS publishes. Early readings are automatic and are revised by a reviewer, so a magnitude here may change.

The saved copy in `public/data/snapshot/` is a real run of those feeds, recorded with the date and time it was taken.

## Licence

The code in this repository is available under the MIT licence. See [LICENSE](LICENSE).

Lattice Grid itself is a separate commercial product with its own terms. It is free to use on localhost, with no key and no watermark, so a copy of this repository runs unrestricted on your own machine. This demo carries a key for its own published address only, which is why you will find one in the source. Keys for your own sites come from [latticegrid.dev](https://www.latticegrid.dev).

---
Built with [Lattice Grid](https://www.latticegrid.dev), a JavaScript data grid with a Data Router: one live feed keeps grids, charts, boards, Gantt and KPI tiles in step. [Documentation](https://www.latticegrid.dev/docs/) · [Demos](https://www.latticegrid.dev/demos/) · [Licence](https://www.latticegrid.dev/licence/)
