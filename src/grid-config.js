/**
 * The columns, the formatting rules, the chart specifications and the tiles.
 *
 * Every one of these is built once, here, at module scope, and never rebuilt.
 * That is not tidiness, it is a requirement of the React adapter: it compares
 * each config prop with `Object.is` and pushes anything that differs into the
 * live grid through `setAll`. A column array built inside a component is a new
 * array on every render, so it would never match, and the grid would be handed
 * a full column reconfiguration every time an unrelated number on the page
 * moved. Built once, the reference never changes and the comparison is free.
 */

import { ALERT_LABELS, ALERT_LEVELS, NOTABLE_MAG } from './usgs-feed.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A row's time as an instant.
 *
 * A panel bound to a grid does not hand a tile the grid's rows: it hands it a
 * projection of each row through the grid's own value pipeline, and the value
 * of a datetime column there is the grid's wall-clock text rather than the
 * number the feed carried. It is read back into milliseconds before anything
 * does arithmetic on it. A raw row, as a plain array panel would hold, is
 * already a number.
 *
 * @param {object} row a row, projected or raw
 * @returns {number} milliseconds since the epoch, or NaN when there is none
 */
export function timeOf(row) {
  return typeof row.time === 'number' ? row.time : Date.parse(row.time);
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

/**
 * The earthquake columns, grouped under four headings.
 *
 * `flash: true` on the columns that USGS revises is what makes a correction
 * visible: when a review changes a magnitude or a place, that cell lights up
 * rather than changing silently under the reader.
 */
function quakeColumns() {
  const coordinate = {
    type: 'number',
    format: { decimals: 3, thousandsSeparator: false },
    filter: { type: 'number' },
    layout: { width: 96 },
  };

  return [
    {
      title: 'When',
      columns: [
        {
          id: 'time',
          field: 'time',
          title: 'Local time',
          type: 'datetime',
          filter: { type: 'date' },
          /*
           * Newest first, which is what a live feed should open on. It also
           * decides the order of the per-day chart: a chart lays its
           * categories out in the order the table walks its rows, so the
           * table's sort is the chart's axis. "Largest first" is a click away.
           */
          sort: { direction: 'desc' },
          layout: { width: 160 },
        },
        {
          id: 'timeUtc',
          title: 'UTC',
          /* The same instant, written in UTC. A reader comparing notes with
             USGS needs this, because every figure USGS publishes is UTC. A
             computed column rather than a second stored field: it is the
             `time` column read a different way. */
          value: {
            deps: ['time'],
            compute: (deps) => {
              const ms = Number(deps.time);
              if (!Number.isFinite(ms)) return null;
              return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
            },
          },
          filter: { type: 'text' },
          layout: { width: 170 },
        },
        {
          id: 'day',
          field: 'day',
          title: 'Day',
          filter: { type: 'set' },
          layout: { width: 110, hidden: true },
        },
      ],
    },
    {
      title: 'The earthquake',
      columns: [
        {
          id: 'mag',
          field: 'mag',
          title: 'Magnitude',
          type: 'number',
          format: { decimals: 1 },
          filter: { type: 'number' },
          flash: true,
          total: 'max',
          groupTotal: 'max',
          layout: { width: 110 },
        },
        {
          id: 'magChange',
          title: 'Revision',
          /* A value the grid keeps about the magnitude column's own history,
             not a field in the feed: how far this event's magnitude has moved
             since it first arrived. */
          shadow: { of: 'mag', kind: 'delta' },
          type: 'number',
          format: { decimals: 1 },
          filter: { type: 'number' },
          layout: { width: 100 },
        },
        {
          id: 'revisions',
          title: 'Revised',
          shadow: { of: 'mag', kind: 'updates' },
          type: 'number',
          filter: { type: 'number' },
          layout: { width: 90, hidden: true },
        },
        {
          id: 'magType',
          field: 'magType',
          title: 'Scale',
          filter: { type: 'set' },
          layout: { width: 90 },
        },
        {
          id: 'place',
          field: 'place',
          title: 'Place',
          filter: { type: 'text' },
          flash: true,
          layout: { width: 300 },
        },
      ],
    },
    {
      title: 'Impact',
      columns: [
        {
          id: 'alert',
          field: 'alert',
          title: 'PAGER alert',
          lookup: { options: Object.entries(ALERT_LABELS).map(([id, label]) => ({ id, label })) },
          filter: { type: 'set' },
          layout: { width: 130 },
        },
        {
          id: 'tsunami',
          field: 'tsunami',
          title: 'Tsunami flag',
          type: 'boolean',
          filter: { type: 'boolean' },
          layout: { width: 120 },
        },
        {
          id: 'felt',
          field: 'felt',
          title: 'Felt reports',
          type: 'number',
          filter: { type: 'number' },
          total: 'sum',
          groupTotal: 'sum',
          layout: { width: 110 },
        },
        {
          id: 'sig',
          field: 'sig',
          title: 'Significance',
          type: 'number',
          filter: { type: 'number' },
          layout: { width: 110, hidden: true },
        },
      ],
    },
    {
      title: 'Where and who',
      columns: [
        {
          id: 'depth',
          field: 'depth',
          title: 'Depth (km)',
          type: 'number',
          format: { decimals: 1 },
          filter: { type: 'number' },
          layout: { width: 110 },
        },
        { ...coordinate, id: 'lat', field: 'lat', title: 'Latitude' },
        { ...coordinate, id: 'lng', field: 'lng', title: 'Longitude' },
        {
          id: 'net',
          field: 'net',
          title: 'Network',
          filter: { type: 'set' },
          layout: { width: 100 },
        },
        {
          id: 'status',
          field: 'status',
          title: 'Status',
          filter: { type: 'set' },
          flash: true,
          layout: { width: 110 },
        },
        {
          id: 'url',
          field: 'url',
          title: 'USGS page',
          cell: { render: 'link', props: { text: 'Open', target: '_blank', rel: 'noopener' } },
          filter: { type: 'none' },
          sort: false,
          layout: { width: 110 },
        },
        /* Always 1. It is what the charts add up and what a group subtotal
           counts, so it is available but starts out of the way. */
        {
          id: 'count',
          field: 'count',
          title: 'Events',
          type: 'number',
          total: 'sum',
          groupTotal: 'sum',
          filter: { type: 'none' },
          layout: { width: 90, hidden: true },
        },
      ],
    },
  ];
}

/**
 * The traffic lights on the PAGER alert column, and a scale on magnitude.
 *
 * These are conditional formatting rules the grid holds as runtime state, so
 * a reader can open the Formatting panel and change them.
 */
function formattingRules() {
  const alertColours = {
    green: { background: '#1b5e20', color: '#ffffff' },
    yellow: { background: '#f9a825', color: '#1b1b1b' },
    orange: { background: '#e65100', color: '#ffffff' },
    red: { background: '#b3261e', color: '#ffffff' },
  };
  return {
    alert: ALERT_LEVELS.map((level) => ({
      id: `alert-${level}`,
      label: `PAGER ${ALERT_LABELS[level]}`,
      when: { op: 'eq', value: level },
      style: { ...alertColours[level], fontWeight: '600', textAlign: 'center' },
    })),
    mag: [
      {
        id: 'mag-notable',
        label: `Magnitude ${NOTABLE_MAG} and above`,
        when: { op: 'gte', value: NOTABLE_MAG },
        style: { fontWeight: '700', color: '#b3261e' },
      },
    ],
    magChange: [
      {
        id: 'mag-revised-up',
        label: 'Revised upwards',
        when: { op: 'gt', value: 0 },
        style: { color: '#b3261e', fontWeight: '600' },
      },
      {
        id: 'mag-revised-down',
        label: 'Revised downwards',
        when: { op: 'lt', value: 0 },
        style: { color: '#1b5e20', fontWeight: '600' },
      },
    ],
  };
}

const COLUMNS = quakeColumns();
const FORMATTING = formattingRules();

/** The settings both tables share, as one frozen object. */
const BASE_GRID_CONFIG = {
  rowKey: 'id',
  columns: COLUMNS,
  formatting: FORMATTING,
  theme: 'light',
  density: 'compact',
  stripedRows: true,
  columnMenu: true,
  groupPanel: true,
  statusBar: true,
  find: true,
  grandTotalRow: 'bottom',
  groupDefaultExpanded: 0,
  toolPanel: { side: 'right', panels: ['filters', 'columns', 'formatting'] },
  selection: 'multiple',
  /* A corrected magnitude or place lights up for a moment rather than
     changing silently. This is the whole point of the live view. */
  highlightOnChange: { colour: '#ffe8a3', duration: 2500 },
};

/**
 * The two tables, each as a finished props object.
 *
 * Frozen and built once, so the reference a component hands the adapter is the
 * same reference on every render and the adapter's comparison finds nothing to
 * do. A component that spread these into a fresh object literal would undo
 * that, which is why they are complete rather than partial.
 *
 * Each opens with its own empty `rows` array, and that matters: the grid keeps
 * the array it is given and writes into it as rows arrive, so two grids
 * sharing one array is two grids sharing their contents. The tables here start
 * empty and are filled by the data router in keyed diffs, so what the arrays
 * are is `[]` — but they must be two of them.
 */
export const ALL_GRID_PROPS = Object.freeze({
  ...BASE_GRID_CONFIG,
  rows: [],
  title: 'Earthquakes in the last seven days',
});

export const SIGNIFICANT_GRID_PROPS = Object.freeze({
  ...BASE_GRID_CONFIG,
  rows: [],
  title: 'Significant earthquakes in the last month',
});

/* ------------------------------------------------------------------ */
/* The charts                                                          */
/* ------------------------------------------------------------------ */

/** The four charts, in the order they are laid out. */
export const CHART_SPECS = Object.freeze([
  {
    type: 'histogram',
    x: 'mag',
    /* The measure is named even though a histogram counts: without a `y`
       every bar comes back with no height and the chart draws nothing. */
    y: 'count',
    buckets: 14,
    title: 'How many earthquakes at each magnitude',
    /*
     * The bars and their order are right, lowest magnitude on the left.
     * The numbers along the bottom are band numbers rather than
     * magnitudes, so the axis is titled to say so: asking for the labels
     * to be hidden has no effect on this chart type, and a bare row of
     * numbers that looked like magnitudes would be worse than a row that
     * is plainly labelled as bands.
     */
    axis: { x: 'Magnitude band, lowest to highest', y: 'Earthquakes' },
    legend: false,
  },
  {
    type: 'bar',
    x: 'day',
    y: 'count',
    title: 'Earthquakes recorded each day',
    axis: { y: 'Earthquakes', x: { labels: true, rotate: 'auto' } },
    legend: false,
  },
  {
    type: 'scatter',
    x: 'mag',
    y: 'depth',
    title: 'Depth against magnitude',
    axis: { x: 'Magnitude', y: 'Depth in kilometres' },
    legend: false,
  },
  {
    type: 'bar',
    x: 'net',
    y: 'count',
    title: 'Which network recorded them',
    axis: { y: 'Earthquakes', x: { labels: true } },
    legend: false,
  },
]);

/* ------------------------------------------------------------------ */
/* The tiles                                                           */
/* ------------------------------------------------------------------ */

/**
 * The headline figures.
 *
 * Two of them are about elapsed time rather than about the rows, and one of
 * those needs to know when the feed last answered, which is not a property of
 * any row. It is read through a getter the host supplies, so the tiles stay a
 * plain, hoisted constant rather than being rebuilt whenever the status moves.
 *
 * @param {() => number|null} lastPollAt when the feed last answered
 */
export function quakeTiles(lastPollAt) {
  return [
    { id: 'events', label: 'Earthquakes in the window', aggregation: 'count', format: 'number' },
    {
      id: 'largest',
      label: 'Largest magnitude',
      aggregation: 'max',
      field: 'mag',
      format: { type: 'number', decimals: 1 },
    },
    {
      id: 'notable24',
      label: `M${NOTABLE_MAG}+ in the last 24 hours`,
      aggregation: 'custom',
      format: 'number',
      compute: (tileRows) => {
        const since = Date.now() - DAY_MS;
        let n = 0;
        for (const row of tileRows) {
          if (typeof row.mag === 'number' && row.mag >= NOTABLE_MAG && timeOf(row) >= since) n += 1;
        }
        return n;
      },
    },
    {
      id: 'sinceLatest',
      label: 'Minutes since the latest',
      aggregation: 'custom',
      format: { type: 'number', decimals: 0 },
      /* Quiet is normal; a long silence usually means the feed, not the
         planet, has gone quiet. */
      thresholds: { warn: 60, critical: 240, direction: 'lowerIsBetter' },
      compute: (tileRows) => {
        let newest = 0;
        for (const row of tileRows) {
          const at = timeOf(row);
          if (at > newest) newest = at;
        }
        if (!newest) return null;
        return Math.max(0, Math.round((Date.now() - newest) / 60000));
      },
    },
    {
      id: 'sincePoll',
      label: 'Minutes since the last update',
      aggregation: 'custom',
      format: { type: 'number', decimals: 0 },
      thresholds: { warn: 2, critical: 5, direction: 'lowerIsBetter' },
      compute: () => {
        const at = lastPollAt();
        if (!at) return null;
        return Math.max(0, Math.round((Date.now() - at) / 60000));
      },
    },
  ];
}
