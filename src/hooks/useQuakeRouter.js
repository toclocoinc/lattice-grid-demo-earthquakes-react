/**
 * The hub: one arriving stream of earthquakes, and every view built on top of
 * it.
 *
 * The data router is the hub and this hook owns it. Nothing here renders
 * anything and nothing here fetches anything; it holds the rows the page has,
 * routes them to whichever grids have been handed to it, and rolls the seven
 * day window forward on a timer.
 *
 * How the pieces fit together:
 *
 *   the feed  ->  the router  ->  the All grid       ->  the tiles
 *                             ->  the Significant grid    the four charts
 *                             ->  a plain subscriber (the activity readout)
 *
 * Why the router is created in an effect rather than in a `useState`
 * initialiser or a lazy ref: React calls an initialiser more than once by
 * design, and the copy it throws away would never be destroyed. An effect is
 * the only place in React that comes with a matching teardown, so anything
 * with a `destroy` belongs in one.
 *
 * A note on how the seven day window is kept.
 *
 * The grid has a rolling time window of its own: `maxAge` and `ageBy` on a
 * stream source, which is exactly this shape of problem. It is not used here,
 * because a stream source that is still open makes the table stop filtering
 * and stop grouping, silently and with no warning: a filter set on one matches
 * every row, and asking for groups produces none. Both come back the moment
 * the stream is declared finished, which a live feed never is. A table nobody
 * can filter is not worth a window, so the window is kept here instead, by
 * deleting through the router.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDataRouter } from '../lattice.js';
import { WINDOW_MS } from '../usgs-feed.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 30000;

/**
 * @param {object} options
 * @param {object[]} options.initialRows the earthquakes to start with
 * @returns {object} the router, the store, and the ways to move rows through them
 */
export function useQuakeRouter({ initialRows }) {
  /** Everything the page currently holds, by id. The router drives the views. */
  const storeRef = useRef(null);
  if (storeRef.current === null) storeRef.current = new Map();

  /** Ids taken out of the All table by age while still held for the significant table. */
  const outOfWindowRef = useRef(null);
  if (outOfWindowRef.current === null) outOfWindowRef.current = new Set();

  /* The live counters. Held in a ref rather than in state because they move on
     every routed change, and the readout that shows them only needs to be
     redrawn once a poll has finished. `publish` is what makes them visible. */
  const statusRef = useRef({
    lastPoll: null,
    lastError: null,
    polls: 0,
    revisions: 0,
    arrivals: 0,
    dropped: 0,
  });
  const [status, setStatus] = useState(statusRef.current);
  const publish = useCallback(() => setStatus({ ...statusRef.current }), []);

  const [router, setRouter] = useState(null);
  const routerRef = useRef(null);
  const allGridRef = useRef(null);

  /* The starting rows, read once. A later render passing a different array
     must not refill the store behind the router's back. */
  const initialRef = useRef(initialRows);

  useEffect(() => {
    /*
     * One stream in, several viewers out.
     *
     * `overlap: true` is what lets a significant earthquake reach both tables:
     * without it a record stops at the first route it matches and the second
     * table would silently receive nothing.
     *
     * `seq: 'updated'` is the feed's own revision clock. USGS stamps every
     * revision with the moment it was made, so an older copy of a row arriving
     * after a newer one is dropped rather than undoing the correction.
     */
    const made = createDataRouter({
      key: (row) => (row.significant ? 'significant' : 'all'),
      rowKey: 'id',
      overlap: true,
      seq: 'updated',
    });

    /* A route that renders nothing: it counts what arrives, for the readout
       under the masthead. The router hands it the same keyed diff a table
       gets. */
    made.subscribe(
      () => true,
      (change) => {
        statusRef.current.arrivals += (change.add || []).length;
        statusRef.current.revisions += (change.update || []).length;
      },
    );

    const store = storeRef.current;
    store.clear();
    outOfWindowRef.current.clear();
    for (const row of initialRef.current) store.set(row.id, row);
    /* A snapshot is a keyed diff, so calling this again later updates what
       changed rather than repainting everything. */
    made.load([...store.values()]);

    routerRef.current = made;
    setRouter(() => made);

    return () => {
      routerRef.current = null;
      setRouter(() => null);
      made.destroy();
      store.clear();
      outOfWindowRef.current.clear();
      statusRef.current = { lastPoll: null, lastError: null, polls: 0, revisions: 0, arrivals: 0, dropped: 0 };
    };
  }, []);

  /**
   * Put rows into the store and through the router.
   *
   * @param {object[]} incoming the rows to apply
   * @returns {number} how many rows were applied
   */
  const ingest = useCallback((incoming) => {
    const live = routerRef.current;
    if (!live || !incoming || !incoming.length) return 0;
    for (const row of incoming) storeRef.current.set(row.id, row);
    live.apply(incoming.map((row) => ({ op: 'upsert', row })));
    statusRef.current.dropped = live.dropped || 0;
    return incoming.length;
  }, []);

  /**
   * Roll the window forward: take out everything that has aged past it.
   *
   * An ordinary earthquake leaves after seven days. A significant one is kept
   * for a month, because the significant table reads a month long feed and
   * still shows it; it leaves the All table anyway, because that table only
   * ever shows the routed rows younger than the window.
   *
   * @returns {number} how many earthquakes were dropped
   */
  const pruneWindow = useCallback(() => {
    const live = routerRef.current;
    if (!live) return 0;
    const now = Date.now();
    const goneFromAll = [];
    const goneEntirely = [];
    for (const [id, row] of storeRef.current) {
      const age = now - row.time;
      if (age <= WINDOW_MS) continue;
      if (row.significant && age <= 30 * DAY_MS) {
        /* Still wanted by the significant table, so it only leaves the
           window. Remembered, so a later pass does not keep asking the table
           to remove a row that has already gone. */
        if (!outOfWindowRef.current.has(id)) {
          goneFromAll.push(id);
          outOfWindowRef.current.add(id);
        }
      } else {
        goneEntirely.push(id);
        storeRef.current.delete(id);
        outOfWindowRef.current.delete(id);
      }
    }
    if (goneEntirely.length) {
      live.apply(goneEntirely.map((id) => ({ op: 'delete', row: { id } })));
    }
    if (goneFromAll.length && allGridRef.current) {
      allGridRef.current.rows.apply({ remove: goneFromAll });
    }
    return goneEntirely.length + goneFromAll.length;
  }, []);

  /**
   * Attach the All table.
   *
   * The route admits what is inside the window, so a month old significant
   * earthquake never enters it in the first place. Ageing out afterwards is
   * the job of `pruneWindow`.
   *
   * Returns the detach, so the caller can use it as an effect's cleanup.
   */
  const attachAll = useCallback((grid) => {
    const live = routerRef.current;
    if (!live || !grid) return undefined;
    allGridRef.current = grid;
    live.attach(grid, (row) => Date.now() - row.time <= WINDOW_MS);
    live.load([...storeRef.current.values()]);
    return () => {
      if (allGridRef.current === grid) allGridRef.current = null;
      /*
       * The router lets go of the grid; React's own teardown destroys it.
       * Skipped when the router itself has already gone: effects are cleaned
       * up in the order they were declared, so on an unmount the router is
       * destroyed first, and destroying it detaches every grid anyway.
       */
      if (routerRef.current === live) live.detach(grid);
    };
  }, []);

  /**
   * Attach the significant table, and fill it from what the page already
   * holds. A snapshot is a keyed diff, so this fills the new table without
   * repainting the one that was already there.
   */
  const attachSignificant = useCallback((grid) => {
    const live = routerRef.current;
    if (!live || !grid) return undefined;
    live.attach(grid, (row) => row.significant === true);
    outOfWindowRef.current.clear();
    live.load([...storeRef.current.values()]);
    pruneWindow();
    return () => {
      if (routerRef.current === live) live.detach(grid);
    };
  }, [pruneWindow]);

  /* The window rolls forward whether or not anything arrives. Without this the
     oldest day would sit in the table until the next earthquake happened to be
     reported, which on a quiet feed can be a long time. */
  const prunedRef = useRef(null);
  prunedRef.current = pruneWindow;
  useEffect(() => {
    const timer = setInterval(() => prunedRef.current(), PRUNE_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  /** Record a poll that landed. */
  const notePoll = useCallback(
    (at) => {
      statusRef.current.lastPoll = at || Date.now();
      statusRef.current.lastError = null;
      statusRef.current.polls += 1;
      publish();
    },
    [publish],
  );

  /** Record a poll that failed: keep the table, say what happened. */
  const notePollError = useCallback(
    (error) => {
      statusRef.current.lastError = String((error && error.message) || error);
      publish();
      console.warn('[earthquake demo] a poll failed:', statusRef.current.lastError);
    },
    [publish],
  );

  return {
    router,
    store: storeRef.current,
    status,
    statusRef,
    ingest,
    pruneWindow,
    attachAll,
    attachSignificant,
    notePoll,
    notePollError,
    publish,
  };
}
