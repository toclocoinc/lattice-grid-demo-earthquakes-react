/**
 * The masthead: what this page is, and how fresh what you are looking at is.
 *
 * A reader should never have to wonder whether the figures in front of them
 * are today's, so the provenance is stated rather than implied.
 */

import { useEffect, useRef, useState } from 'react';

/** One number, written the way a reader expects to see it. */
function commas(value) {
  return Number(value || 0).toLocaleString('en-GB');
}

/** A clock time, local to whoever is reading. */
function clockText(ms) {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Say when the data last moved, and say plainly when it stopped. */
function freshnessText({ meta, status, replaying }) {
  if (!meta.live) {
    const saved = new Date(meta.fetchedAt).toLocaleString('en-GB');
    const shifted = meta.shiftMs > 60000;
    if (replaying) return `Replaying a run saved on ${saved}, as though it were happening now`;
    if (shifted) return `A run saved on ${saved}, shown as though it were the last seven days`;
    return `A run saved on ${saved}`;
  }
  if (status.lastError) {
    return status.lastPoll
      ? `Could not reach the feed. Still showing what arrived at ${clockText(status.lastPoll)}.`
      : 'Could not reach the feed.';
  }
  if (!status.lastPoll) return 'Waiting for the first update...';
  return (
    `Updated ${clockText(status.lastPoll)}. ` +
    `${commas(status.arrivals)} new, ${commas(status.revisions)} revised since the page opened.`
  );
}

/**
 * @param {object} props
 * @param {object} props.meta where the data came from, and when
 * @param {object} props.status the running counters
 * @param {boolean} props.replaying
 */
export function Masthead({ meta, status, replaying }) {
  /* The pulse that shows a poll landed. A class for a moment, then off again;
     the timer is cleared if another poll lands first or the page goes away. */
  const [beating, setBeating] = useState(false);
  const polls = useRef(status.polls);

  useEffect(() => {
    if (status.polls === polls.current) return undefined;
    polls.current = status.polls;
    setBeating(true);
    const timer = setTimeout(() => setBeating(false), 900);
    return () => clearTimeout(timer);
  }, [status.polls]);

  const failed = Boolean(meta.live && status.lastError);

  return (
    <header className="head">
      <div className="head-text">
        <h1>Earthquakes around the world, as they are recorded</h1>
        <p className="lede">
          Every earthquake the United States Geological Survey has recorded in the last seven days,
          updated each minute. Magnitudes and locations are revised for hours after an event, and a
          revision lands on the row it belongs to rather than adding a second one.
        </p>
        {meta.fellBack ? (
          <p className="notice">
            The USGS earthquake feeds could not be reached, so this is the saved copy. Reloading the
            page will try again.
          </p>
        ) : null}
      </div>
      <div className="head-note">
        <span className="pill">
          {meta.live ? <span className={`dot${beating ? ' beat' : ''}`} /> : null}
          {meta.live ? 'Live' : 'Saved copy'}
        </span>
        <span className={`freshness${failed ? ' failed' : ''}`}>
          {freshnessText({ meta, status, replaying })}
        </span>
      </div>
    </header>
  );
}
