/**
 * The controls above the table.
 *
 * Grouping and ordering act on the grid immediately, so they are handed the
 * instance and call it. The M4.5+ toggle is different: it is React state, and
 * it reaches the grid as a prop on `EarthquakeGrid`, which is the point of the
 * exercise. A control that owns a piece of state and a grid that reads it are
 * the normal way round for React, and the grid is never rebuilt to honour it.
 */

import { NOTABLE_MAG } from '../usgs-feed.js';

/**
 * @param {object} props
 * @param {object|null} props.grid
 * @param {boolean} props.notable
 * @param {(on: boolean) => void} props.onNotable
 * @param {boolean} props.hidden
 */
export function Controls({ grid, notable, onNotable, hidden }) {
  const group = (ids) => () => grid && grid.columns.group(ids);
  const sort = (entries) => () => grid && grid.sort.set(entries);

  return (
    <div className="actions" hidden={hidden}>
      <span className="actions-label">Group by</span>
      <button type="button" className="action" onClick={group(['alert'])}>
        PAGER alert
      </button>
      <button type="button" className="action" onClick={group(['net'])}>
        Network
      </button>
      <button type="button" className="action" onClick={group(['day'])}>
        Day
      </button>
      <button type="button" className="action" onClick={group(['alert', 'day'])}>
        Alert, then day
      </button>
      <button type="button" className="action" onClick={group([])}>
        No grouping
      </button>

      <span className="actions-gap" />
      <span className="actions-label">Order by</span>
      <button type="button" className="action" onClick={sort([{ col: 'time', dir: 'desc' }])}>
        Newest first
      </button>
      <button type="button" className="action" onClick={sort([{ col: 'mag', dir: 'desc' }])}>
        Largest first
      </button>

      <span className="actions-gap" />
      <button
        type="button"
        className={`action toggle${notable ? ' on' : ''}`}
        aria-pressed={notable}
        onClick={() => onNotable(!notable)}
      >
        {`Only M${NOTABLE_MAG} and above`}
      </button>
    </div>
  );
}
