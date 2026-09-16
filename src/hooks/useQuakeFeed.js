/**
 * Keeping the data moving: the minute poll on the live page, and the replay
 * that makes the saved copy move offline.
 *
 * Both are timers with a stop, so both belong in an effect. The handlers are
 * read through a ref rather than listed as dependencies: they are closures
 * that change identity on every render, and depending on them would tear the
 * poll down and start a new one several times a second, which on a one minute
 * interval means the poll would never actually fire.
 */

import { useEffect, useRef } from 'react';
import { POLL_MS, createReplay, startPolling } from '../usgs-feed.js';

/**
 * @param {object} options
 * @param {boolean} options.enabled start only once the dashboard can receive rows
 * @param {boolean} options.live whether the page is reading the feeds
 * @param {object[]|null} options.replayRows the saved run to replay, when asked for
 * @param {Set<string>} options.significantIds the running set, updated in place
 * @param {(result: object) => void} options.onPoll
 * @param {(error: Error) => void} options.onPollError
 * @param {(rows: object[]) => void} options.onReplayBatch
 * @returns {{polling: boolean, replaying: boolean}} what is actually running
 */
export function useQuakeFeed({
  enabled,
  live,
  replayRows,
  significantIds,
  onPoll,
  onPollError,
  onReplayBatch,
}) {
  const handlers = useRef({ onPoll, onPollError, onReplayBatch });
  handlers.current = { onPoll, onPollError, onReplayBatch };

  /*
   * Not started after a fallback: the saved rows have been shifted in time,
   * and a poll that later got through would mix real timestamps in with them.
   * The masthead says that reloading tries the feeds again.
   */
  const polling = Boolean(enabled && live);
  const replaying = Boolean(enabled && replayRows && replayRows.length);

  useEffect(() => {
    if (!polling) return undefined;
    const poller = startPolling({
      significantIds,
      intervalMs: POLL_MS,
      onPoll: (result) => handlers.current.onPoll(result),
      onError: (error) => handlers.current.onPollError(error),
    });
    /* `stop` clears the interval and aborts the request that may be in
       flight, so an unmount leaves neither a timer nor a pending fetch. */
    return () => poller.stop();
  }, [polling, significantIds]);

  useEffect(() => {
    if (!replaying) return undefined;
    const handle = createReplay({
      rows: replayRows,
      onBatch: (batch) => handlers.current.onReplayBatch(batch),
    });
    /* Everything older than the lead is the starting state, delivered at
       once; the rest arrives on the handle's own timer. */
    handlers.current.onReplayBatch(handle.seed);
    return () => handle.stop();
  }, [replaying, replayRows]);

  return { polling, replaying };
}
