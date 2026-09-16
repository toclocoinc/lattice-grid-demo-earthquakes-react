/**
 * Where the earthquakes come from, as a hook.
 *
 * Three ways to open the page, exactly as the plain edition:
 *
 *   (nothing)            live, reading the USGS feeds and polling every minute
 *   ?source=snapshot     the saved copy in `data/snapshot`, held still
 *   ?source=snapshot&replay=1
 *                        the saved copy, fed in over time so it moves offline
 *
 * When the live feeds cannot be reached the page opens the saved copy instead
 * and says so at the top, rather than showing an error.
 *
 * The one thing React adds here is that the load has to be cancellable. In
 * development, StrictMode mounts every component twice on purpose, so this
 * effect runs, is cleaned up, and runs again. Without the abort signal the
 * first load would still be in flight when the second started, and both would
 * try to settle the same state. The `AbortController` is not a nicety: it is
 * what makes the double mount a no-op rather than a race.
 */

import { useEffect, useState } from 'react';
import { fetchInitial, shiftToNow } from '../usgs-feed.js';
import { loadSnapshot } from '../snapshot.js';

/** What the query string asked for. Read once; it cannot change without a reload. */
export function readMode() {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get('source') === 'snapshot' ? 'snapshot' : 'live',
    replayWanted: params.get('replay') === '1',
  };
}

/**
 * Load the starting rows.
 *
 * @returns {{
 *   phase: 'loading'|'ready'|'failed',
 *   message: string,
 *   progress: number,
 *   rows: object[],
 *   replayRows: object[]|null,
 *   meta: object|null,
 *   significantIds: Set<string>,
 *   mode: string,
 *   error: Error|null,
 *   fetchMs: number,
 * }}
 */
export function useQuakeSource() {
  const [state, setState] = useState(() => ({
    phase: 'loading',
    message: 'Starting...',
    progress: 0,
    rows: [],
    replayRows: null,
    meta: null,
    significantIds: new Set(),
    mode: readMode().mode,
    error: null,
    fetchMs: 0,
  }));

  useEffect(() => {
    const { mode, replayWanted } = readMode();
    const controller = new AbortController();
    let cancelled = false;
    const started = performance.now();

    /* Nothing is written back into React after the effect is cleaned up. Every
       settle goes through here so there is one place that rule is kept. */
    const settle = (next) => {
      if (cancelled) return;
      setState((held) => ({ ...held, ...next }));
    };
    const report = (message, progress) => settle({ message, progress });

    (async () => {
      try {
        let rows;
        let meta;
        let significantIds = new Set();

        if (mode === 'snapshot') {
          report('Reading the saved copy...', 0.4);
          const saved = await loadSnapshot({ signal: controller.signal });
          meta = saved.meta;
          rows = saved.rows;
        } else {
          report('Reading the USGS earthquake feeds...', 0.1);
          try {
            const initial = await fetchInitial({ signal: controller.signal, onProgress: report });
            rows = initial.rows;
            significantIds = initial.significantIds;
            meta = {
              live: true,
              fetchedAt: Date.now(),
              feeds: initial.feeds.map((feed) => ({
                name: feed.name,
                title: feed.title,
                generated: feed.generated,
                count: feed.count,
              })),
            };
          } catch (liveError) {
            if (controller.signal.aborted) return;
            /* The feeds are out of our hands, so a bad day for them should not
               be a blank page here. The saved copy shows the same dashboard,
               and the masthead says plainly that is what you are looking at. */
            console.warn(
              '[earthquake demo] the live fetch failed, falling back to the saved copy:',
              liveError,
            );
            report('The USGS earthquake feeds could not be reached. Opening the saved copy...', 0.8);
            const saved = await loadSnapshot({ signal: controller.signal });
            rows = saved.rows;
            meta = { ...saved.meta, live: false, fellBack: true };
          }
        }

        if (cancelled) return;

        /*
         * The saved copy is shifted forward so the newest saved event lands on
         * now, whether it was asked for by name or is standing in for feeds
         * that could not be reached. The window is always the last seven days,
         * so without the shift a copy saved a fortnight ago would open with an
         * empty table. The page says plainly that this is what it is doing.
         *
         * `?replay=1` goes further and releases the last stretch a batch at a
         * time, so the saved copy also moves.
         */
        let replayRows = null;
        let seedRows = rows;
        if (!meta.live) {
          const shifted = shiftToNow(rows);
          meta = { ...meta, shiftMs: shifted.shiftMs };
          if (mode === 'snapshot' && replayWanted) {
            replayRows = shifted.rows;
            seedRows = [];
          } else {
            seedRows = shifted.rows;
          }
        }

        report('Building the dashboard...', 1);
        settle({
          phase: 'ready',
          rows: seedRows,
          replayRows,
          meta,
          significantIds,
          mode,
          fetchMs: Math.round(performance.now() - started),
        });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.error('[earthquake demo]', error);
        settle({ phase: 'failed', error });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return state;
}
