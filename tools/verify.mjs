/**
 * Load the demo in a real browser and check that it works.
 *
 * It runs in two halves, because a React application is two different programs.
 *
 *   The development server, where React's StrictMode mounts every component
 *   twice on purpose and React's own warnings are compiled in. This is where
 *   the claims this edition exists to make are tested: that the double mount
 *   leaves exactly one grid, that taking the application off the page leaves
 *   no listener, timer or request behind, and that a prop change reaches the
 *   grid that is already there rather than building a new one. The counters
 *   are read from the page rather than inferred from how it looks.
 *
 *   The built `dist/`, served statically, which is what actually gets
 *   published. This is the deployment gate: the table holds rows, the charts
 *   drew marks, every headline figure agrees with the saved feed recomputed
 *   here in Node, and the page logged nothing.
 *
 * `--compare <dir>` also opens the plain-JavaScript edition of the same demo
 * and checks the two agree row for row, figure for figure and mark for mark.
 *
 * Exits non-zero when any of that fails, so it can gate a deployment.
 *
 * Usage: node tools/verify.mjs [--compare <dir>] [--shots <dir>]
 */

import { spawn } from 'node:child_process';
import { createServer as createSocketProbe } from 'node:net';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { BASE, startServer } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const shotIndex = args.indexOf('--shots');
const shotDir = shotIndex >= 0 ? resolve(args[shotIndex + 1]) : null;
const compareIndex = args.indexOf('--compare');
const compareDir = compareIndex >= 0 ? resolve(args[compareIndex + 1]) : null;

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOTABLE_MAG = 4.5;

/* The window is measured from the moment the page read the clock, and the
   check reads it again a little later, so rows near the boundary are checked
   against a range rather than a point. */
const SLACK_MS = WINDOW_MS * 0.1 + 1000;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

/** The first browser on this machine that actually exists. */
async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  throw new Error(`No browser found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}\nSet CHROME_PATH to point at one.`);
}

/**
 * This check talks to the browser over a WebSocket, which Node only provides
 * as a global from version 22. Say so plainly rather than failing later with
 * an unexplained missing name.
 */
function requireModernNode() {
  if (typeof WebSocket === 'undefined') {
    throw new Error(
      `This check needs Node 22 or newer. You are running ${process.version}, which has no built in WebSocket.`,
    );
  }
}

/** A free TCP port, asked of the operating system. */
function freePort() {
  return new Promise((ok, reject) => {
    const probe = createSocketProbe();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

const failures = [];
const notes = [];

/** Record a check and its outcome. */
function check(ok, description, detail) {
  if (ok) {
    notes.push(`  ok   ${description}${detail ? ` (${detail})` : ''}`);
  } else {
    failures.push(`${description}${detail ? ` (${detail})` : ''}`);
    notes.push(`  FAIL ${description}${detail ? ` (${detail})` : ''}`);
  }
}

/*
 * The probe, installed into every document before any of its own script runs.
 *
 * It lives here rather than in the demo because it is a test instrument and
 * the demo should not carry one. It replaces the timer, request and listener
 * entry points with counting versions, so "nothing was left behind" can be a
 * measurement rather than an impression.
 */
const PROBE = `(() => {
  const probe = {
    intervals: new Set(),
    timeouts: new Set(),
    fetchesStarted: 0,
    fetchesOpen: 0,
    listeners: new Map(),
    listenerAdds: 0,
    listenerRemoves: 0,
  };
  const setInterval_ = window.setInterval.bind(window);
  const clearInterval_ = window.clearInterval.bind(window);
  window.setInterval = (...a) => { const id = setInterval_(...a); probe.intervals.add(id); return id; };
  window.clearInterval = (id) => { probe.intervals.delete(id); return clearInterval_(id); };

  const setTimeout_ = window.setTimeout.bind(window);
  const clearTimeout_ = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...rest) => {
    let id;
    const wrapped = typeof fn === 'function'
      ? (...a) => { probe.timeouts.delete(id); return fn(...a); }
      : fn;
    id = setTimeout_(wrapped, ms, ...rest);
    probe.timeouts.add(id);
    return id;
  };
  window.clearTimeout = (id) => { probe.timeouts.delete(id); return clearTimeout_(id); };

  const fetch_ = window.fetch.bind(window);
  window.fetch = (...a) => {
    probe.fetchesStarted += 1;
    probe.fetchesOpen += 1;
    const done = () => { probe.fetchesOpen -= 1; };
    return fetch_(...a).then((r) => { done(); return r; }, (e) => { done(); throw e; });
  };

  /* Only window and document are counted. A listener on an element the grid
     owns goes when that element does, and counting those would drown the
     signal in noise; a listener left on window or document is a real leak. */
  const name = (target) => (target === window ? 'window' : target === document ? 'document' : null);
  const add_ = EventTarget.prototype.addEventListener;
  const remove_ = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    const where = name(this);
    if (where) {
      const key = where + ':' + type;
      probe.listeners.set(key, (probe.listeners.get(key) || 0) + 1);
      probe.listenerAdds += 1;
    }
    return add_.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    const where = name(this);
    if (where) {
      const key = where + ':' + type;
      const held = probe.listeners.get(key) || 0;
      if (held > 0) probe.listeners.set(key, held - 1);
      probe.listenerRemoves += 1;
    }
    return remove_.call(this, type, fn, opts);
  };

  window.__probe = probe;
  window.__probeRead = () => ({
    intervals: probe.intervals.size,
    timeouts: probe.timeouts.size,
    fetchesStarted: probe.fetchesStarted,
    fetchesOpen: probe.fetchesOpen,
    listenerAdds: probe.listenerAdds,
    listenerRemoves: probe.listenerRemoves,
    listeners: Object.fromEntries([...probe.listeners].filter(([, n]) => n > 0)),
    listenerTotal: [...probe.listeners.values()].reduce((n, v) => n + v, 0),
  });
})();`;

let browser;
let browserPid = null;
let profile;
let distServer;
let plainServer;
let devServer;

try {
  requireModernNode();
  const chromePath = await findChrome();

  const dist = await startServer(0);
  distServer = dist.server;
  const distOrigin = `http://127.0.0.1:${dist.port}`;
  console.log(`Browser: ${chromePath}`);
  console.log(`Serving dist: ${distOrigin}${BASE}`);

  profile = await mkdtemp(join(tmpdir(), 'quake-react-verify-'));
  const port = await freePort();
  /* Its own process group, so the whole browser tree can be taken down
     together rather than leaving orphaned renderers behind. */
  browser = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  browserPid = browser.pid;
  browser.stderr.on('data', () => {});

  let wsUrl;
  for (let i = 0; i < 150 && !wsUrl; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('the browser never opened its debugging port');

  const socket = new WebSocket(wsUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () => fail(new Error('could not attach to the browser'));
  });

  let nextId = 0;
  const pending = new Map();
  let consoleErrors = [];
  let consoleWarnings = [];
  let pageErrors = [];

  const textOf = (args) => args.map((a) => a.value ?? a.description ?? a.type).join(' ');

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve: ok, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else ok(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      if (message.params.type === 'error') consoleErrors.push(textOf(message.params.args));
      if (message.params.type === 'warning') consoleWarnings.push(textOf(message.params.args));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      pageErrors.push(details.exception?.description || details.text);
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text);
    }
  };

  const send = (method, params = {}, sessionId) =>
    new Promise((ok, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: ok, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    }
    return result.result.value;
  };

  const waitFor = async (expression, timeout, what) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      let value;
      try {
        value = await evaluate(expression);
      } catch {}
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  /** Open a URL with a clean error log and wait for the dashboard to report in. */
  const open = async (url, label) => {
    consoleErrors = [];
    consoleWarnings = [];
    pageErrors = [];
    console.log(`\n--- ${label} ---\n${url}`);
    await call('Page.navigate', { url });
    await waitFor('!!(window.__quakeDemo && window.__quakeDemo.ready)', 120000, `${label} to load`);
    await waitFor('window.__quakeDemo.allGrid && window.__quakeDemo.allGrid.rows.count() > 0', 60000, `${label} rows`);
  };

  /** Save a screenshot, when a directory was asked for. */
  const shoot = async (name) => {
    if (!shotDir) return;
    await mkdir(shotDir, { recursive: true });
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    const file = join(shotDir, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(`  shot ${file}`);
  };

  /** Complain about anything the page logged, React's own warnings included. */
  const noErrors = (label) => {
    check(consoleErrors.length === 0, `${label}: no console errors`, consoleErrors.slice(0, 3).join(' | '));
    check(pageErrors.length === 0, `${label}: no page errors`, pageErrors.slice(0, 3).join(' | '));
    const reactWarnings = consoleWarnings.filter((line) => /warning:|react|strictmode|act\(/i.test(line));
    check(
      reactWarnings.length === 0,
      `${label}: no React warnings`,
      reactWarnings.slice(0, 3).join(' | '),
    );
  };

  /* The saved rows, read here so every figure the page shows can be checked
     against a number computed in Node rather than read back off the page. */
  const savedRows = JSON.parse(await readFile(join(root, 'public', 'data', 'snapshot', 'quakes.json'), 'utf8'));

  /** Everything the page is showing, in one read. */
  const READ_STATE = `(() => {
    const d = window.__quakeDemo;
    return {
      rows: d.allGrid.rows.count(),
      total: d.allGrid.rows.totalCount(),
      columns: d.allGrid.columns.visible().length,
      painted: document.querySelectorAll('.lattice [role="row"]').length,
      shiftMs: d.meta.shiftMs || 0,
      charts: d.charts.length,
      watermark: d.allGrid.licence.watermark(),
      licenceState: d.allGrid.licence.state(),
      tiles: Object.fromEntries(d.kpi.tiles().map((t) => [t.id, t.value])),
      named: document.querySelector('.kpi-named-value').textContent,
      marks: d.charts.map((c) => (c.element ? c.element.querySelectorAll('rect, circle').length : 0)),
      withValue: d.charts.map((c) => {
        const data = c.data();
        const series = (data && data.series) || [];
        return series.reduce((n, s) => n + (s.points || []).filter((p) => p.y != null && p.y !== 0).length, 0);
      }),
    };
  })()`;

  /* =================================================================== */
  /* 1. The development server: React's own checks, at their harshest.   */
  /* =================================================================== */

  const vite = await import('vite');
  const devPort = await freePort();
  devServer = await vite.createServer({
    root,
    logLevel: 'silent',
    server: { port: devPort, strictPort: true, host: '127.0.0.1' },
  });
  await devServer.listen();
  const devOrigin = `http://127.0.0.1:${devPort}`;

  await open(`${devOrigin}${BASE}?source=snapshot`, 'development, StrictMode on');

  /* ---- StrictMode's double mount leaves exactly one grid ---- */

  const strict = await evaluate(`(() => {
    const d = window.__quakeDemo;
    const l = d.lifecycle;
    return {
      created: l.created,
      destroyed: l.destroyed,
      live: l.live.size,
      reconfigured: l.reconfigured,
      latticeRoots: document.querySelectorAll('.lattice').length,
      gridHosts: document.querySelectorAll('.grid-host').length,
      routers: d.router ? 1 : 0,
      /* Five tiles are configured. A second panel left behind by the double
         mount would put ten of them in the host. */
      kpiTilesDrawn: document.querySelectorAll('.kpi-panel > *').length,
      kpiHosts: document.querySelectorAll('.kpi-panel').length,
      chartSvgs: document.querySelectorAll('.chart-mount > *').length,
      charts: d.charts.length,
      rows: d.allGrid.rows.count(),
    };
  })()`);
  console.log(`  grids built ${strict.created}, destroyed ${strict.destroyed}, alive ${strict.live}`);
  console.log(`  .lattice roots on the page ${strict.latticeRoots}, chart elements ${strict.chartSvgs}, KPI tiles drawn ${strict.kpiTilesDrawn}`);

  check(strict.created === 2, 'StrictMode built the grid twice, as it is designed to', `created ${strict.created}`);
  check(strict.destroyed === 1, 'the first of the two was destroyed', `destroyed ${strict.destroyed}`);
  check(strict.live === 1, 'exactly one grid is alive', `${strict.live} alive`);
  check(strict.created - strict.destroyed === strict.live, 'the ledger balances', `${strict.created} - ${strict.destroyed} = ${strict.live}`);
  check(strict.latticeRoots === 1, 'exactly one grid is on the page', `${strict.latticeRoots} .lattice roots`);
  check(strict.gridHosts === 1, 'one mounted grid host', `${strict.gridHosts}`);
  check(strict.kpiHosts === 1, 'exactly one KPI host on the page', `${strict.kpiHosts}`);
  check(strict.kpiTilesDrawn === 5, 'one KPI panel drew its five tiles, not two panels drawing ten', `${strict.kpiTilesDrawn} tiles`);
  check(strict.charts === 4, 'four charts were built', `${strict.charts}`);
  check(strict.chartSvgs === 4, 'four chart elements on the page, not eight', `${strict.chartSvgs}`);
  check(strict.rows > 0, 'the table holds rows', `${strict.rows}`);
  noErrors('development');
  await shoot('01-development-strictmode');

  /* ---- a prop change reaches the grid that is already there ---- */

  const propChange = await evaluate(`(async () => {
    const d = window.__quakeDemo;
    window.__gridBefore = d.allGrid;
    const before = {
      created: d.lifecycle.created,
      destroyed: d.lifecycle.destroyed,
      rows: d.allGrid.rows.count(),
      events: d.kpi.value('events'),
      where: d.allGrid.filters.where(),
      marks: d.charts.map((c) => (c.element ? c.element.querySelectorAll('rect, circle').length : 0)),
    };
    d.setNotable(true);
    await new Promise((r) => setTimeout(r, 900));
    const after = window.__quakeDemo;
    let minMag = Infinity;
    after.allGrid.rows.forEach((r) => {
      if (r && r.data && typeof r.data.mag === 'number' && r.data.mag < minMag) minMag = r.data.mag;
    });
    return {
      before,
      after: {
        created: after.lifecycle.created,
        destroyed: after.lifecycle.destroyed,
        live: after.lifecycle.live.size,
        rows: after.allGrid.rows.count(),
        events: after.kpi.value('events'),
        where: after.allGrid.filters.where(),
        sameInstance: after.allGrid === window.__gridBefore,
        latticeRoots: document.querySelectorAll('.lattice').length,
        minMag,
        pressed: document.querySelector('.action.toggle').getAttribute('aria-pressed'),
        marks: after.charts.map((c) => (c.element ? c.element.querySelectorAll('rect, circle').length : 0)),
      },
    };
  })()`);
  console.log(`  M${NOTABLE_MAG}+ prop: ${propChange.before.rows} rows -> ${propChange.after.rows}, tile ${propChange.before.events} -> ${propChange.after.events}`);
  console.log(`  grids built before ${propChange.before.created}, after ${propChange.after.created}; same instance: ${propChange.after.sameInstance}`);

  check(propChange.after.created === propChange.before.created, 'the prop change built no new grid', `created stayed at ${propChange.after.created}`);
  check(propChange.after.destroyed === propChange.before.destroyed, 'the prop change destroyed no grid', `destroyed stayed at ${propChange.after.destroyed}`);
  check(propChange.after.sameInstance === true, 'the page is still holding the same grid object');
  check(propChange.after.latticeRoots === 1, 'still exactly one grid on the page', `${propChange.after.latticeRoots}`);
  check(propChange.after.rows < propChange.before.rows, 'the prop narrowed the table', `${propChange.before.rows} -> ${propChange.after.rows}`);
  check(propChange.after.events < propChange.before.events, 'the prop moved the event tile', `${propChange.before.events} -> ${propChange.after.events}`);
  check(propChange.after.minMag >= NOTABLE_MAG, 'every remaining row is above the threshold', `smallest ${propChange.after.minMag}`);
  check(propChange.after.pressed === 'true', 'the control reports itself pressed');
  check(
    propChange.after.where.includes('notable') && !propChange.before.where.includes('notable'),
    'the prop registered a named predicate rather than replacing the filter set',
    `before [${propChange.before.where}], after [${propChange.after.where}]`,
  );
  const marksMoved = propChange.after.marks.filter((n, i) => n !== propChange.before.marks[i]).length;
  check(marksMoved > 0, 'the charts rebound to the narrowed data', `${marksMoved} of 4 changed`);
  await shoot('02-prop-change');

  const restored = await evaluate(`(async () => {
    const d = window.__quakeDemo;
    d.setNotable(false);
    await new Promise((r) => setTimeout(r, 900));
    const after = window.__quakeDemo;
    return {
      rows: after.allGrid.rows.count(),
      created: after.lifecycle.created,
      where: after.allGrid.filters.where(),
      sameInstance: after.allGrid === window.__gridBefore,
    };
  })()`);
  check(restored.rows === propChange.before.rows, 'removing the prop restores the table', `${restored.rows} of ${propChange.before.rows}`);
  check(restored.created === propChange.before.created, 'and still built no new grid', `created ${restored.created}`);
  check(!restored.where.includes('notable'), 'and removed the named predicate', `[${restored.where}]`);
  check(restored.sameInstance === true, 'and it is still the same grid object');

  /* ---- the second tab mounts on demand, and stays ---- */

  const tabbed = await evaluate(`(async () => {
    const d = window.__quakeDemo;
    const before = { created: d.lifecycle.created, significant: !!d.significantGrid, roots: document.querySelectorAll('.lattice').length };
    d.setActiveTab('significant');
    await new Promise((r) => setTimeout(r, 1200));
    const mid = window.__quakeDemo;
    const opened = {
      created: mid.lifecycle.created,
      rows: mid.significantGrid ? mid.significantGrid.rows.count() : 0,
      roots: document.querySelectorAll('.lattice').length,
      allSignificant: (() => {
        let all = true;
        mid.significantGrid.rows.forEach((r) => { if (r && r.data && r.data.significant !== true) all = false; });
        return all;
      })(),
    };
    mid.setActiveTab('all');
    await new Promise((r) => setTimeout(r, 900));
    const back = window.__quakeDemo;
    return {
      before,
      opened,
      back: {
        created: back.lifecycle.created,
        destroyed: back.lifecycle.destroyed,
        live: back.lifecycle.live.size,
        rows: back.allGrid.rows.count(),
        /* The table that was hidden and is now showing again has to be
           drawn, not just alive. */
        painted: document.querySelectorAll('[role="tabpanel"]:not([hidden]) .lattice [role="row"]').length,
      },
    };
  })()`);
  console.log(`  significant tab: ${tabbed.opened.rows} rows, grids built ${tabbed.before.created} -> ${tabbed.opened.created}`);
  const expectedSignificant = savedRows.filter((row) => row.significant).length;
  check(tabbed.before.significant === false, 'the second table is not built until its tab is opened');
  check(tabbed.opened.created > tabbed.before.created, 'opening it built it', `${tabbed.before.created} -> ${tabbed.opened.created}`);
  check(tabbed.opened.roots === 2, 'and there are now two grids on the page, not three', `${tabbed.opened.roots} .lattice roots`);
  check(tabbed.opened.rows === expectedSignificant, 'the significant table matches the saved significant feed', `${tabbed.opened.rows} against ${expectedSignificant}`);
  check(tabbed.opened.allSignificant, 'the significant table holds only significant earthquakes');
  check(tabbed.back.live === 2, 'going back keeps both tables alive rather than rebuilding', `${tabbed.back.live} alive`);
  check(tabbed.back.painted > 0, 'the table that was hidden is drawn again when its tab comes back', `${tabbed.back.painted} rows painted`);
  check(
    tabbed.back.created - tabbed.back.destroyed === tabbed.back.live,
    'the ledger still balances',
    `${tabbed.back.created} - ${tabbed.back.destroyed} = ${tabbed.back.live}`,
  );
  await shoot('03-significant-tab');

  /* ---- unmount and remount leaves nothing behind ---- */

  /*
   * Measured across two identical cycles rather than against a guess at what
   * a clean page looks like. Whatever the first unmount settles on, the second
   * has to settle on exactly the same thing: if anything at all accumulates —
   * a timer, a listener, a request, a grid — the two readings differ.
   */
  const takeDown = `(async () => {
    window.__quakeDemoApp.unmount();
    await new Promise((r) => setTimeout(r, 1200));
    return {
      probe: window.__probeRead(),
      lifecycle: {
        created: window.__quakeDemoApp.lifecycle.created,
        destroyed: window.__quakeDemoApp.lifecycle.destroyed,
        live: window.__quakeDemoApp.lifecycle.live.size,
      },
      appChildren: document.querySelector('#app').childElementCount,
      latticeRoots: document.querySelectorAll('.lattice').length,
      chartSvgs: document.querySelectorAll('.chart-mount > *').length,
    };
  })()`;

  const down1 = await evaluate(takeDown);
  console.log(`  after unmount 1: intervals ${down1.probe.intervals}, pending timeouts ${down1.probe.timeouts}, open fetches ${down1.probe.fetchesOpen}, window/document listeners ${down1.probe.listenerTotal}, grids alive ${down1.lifecycle.live}`);
  console.log(`    listeners still registered: ${JSON.stringify(down1.probe.listeners)}`);

  check(down1.lifecycle.live === 0, 'unmounting destroyed every grid', `${down1.lifecycle.live} alive`);
  check(down1.lifecycle.created === down1.lifecycle.destroyed, 'every grid ever built was destroyed', `${down1.lifecycle.created} built, ${down1.lifecycle.destroyed} destroyed`);
  check(down1.appChildren === 0, 'the application left no DOM behind', `${down1.appChildren} children under #app`);
  check(down1.latticeRoots === 0, 'no grid is left on the page', `${down1.latticeRoots}`);
  check(down1.chartSvgs === 0, 'no chart is left on the page', `${down1.chartSvgs}`);
  check(down1.probe.fetchesOpen === 0, 'no request is still in flight', `${down1.probe.fetchesOpen}`);
  /*
   * The interval count is reported rather than required to be zero: the
   * development server's own client keeps one, and that is not the
   * application's. What the application must not do is add to it, which is
   * what the second cycle measures.
   */

  await evaluate(`(async () => {
    window.__quakeDemoApp.mount();
  })()`);
  await waitFor('!!(window.__quakeDemo && window.__quakeDemo.ready)', 120000, 'the remount');
  await waitFor('window.__quakeDemo.allGrid && window.__quakeDemo.allGrid.rows.count() > 0', 60000, 'the remounted rows');
  const remounted = await evaluate(`(() => {
    const d = window.__quakeDemo;
    return { rows: d.allGrid.rows.count(), live: d.lifecycle.live.size, roots: document.querySelectorAll('.lattice').length, charts: d.charts.length };
  })()`);
  console.log(`  remounted: ${remounted.rows} rows, ${remounted.live} grid alive, ${remounted.charts} charts`);
  check(remounted.rows > 0, 'the application comes back after a remount', `${remounted.rows} rows`);
  check(remounted.live === 1, 'and holds one grid again', `${remounted.live}`);
  check(remounted.roots === 1, 'and one grid on the page', `${remounted.roots}`);
  check(remounted.charts === 4, 'and four charts', `${remounted.charts}`);

  const down2 = await evaluate(takeDown);
  console.log(`  after unmount 2: intervals ${down2.probe.intervals}, pending timeouts ${down2.probe.timeouts}, open fetches ${down2.probe.fetchesOpen}, window/document listeners ${down2.probe.listenerTotal}, grids alive ${down2.lifecycle.live}`);
  console.log(`    listeners still registered: ${JSON.stringify(down2.probe.listeners)}`);
  console.log(`  fetches over the whole run: ${down2.probe.fetchesStarted} started, ${down2.probe.fetchesOpen} open`);
  console.log(`  listener calls over the whole run: ${down2.probe.listenerAdds} added, ${down2.probe.listenerRemoves} removed`);

  check(down2.probe.intervals === down1.probe.intervals, 'a mount and unmount cycle leaves no extra interval', `${down1.probe.intervals} -> ${down2.probe.intervals}`);
  check(down2.probe.listenerTotal === down1.probe.listenerTotal, 'it leaves no extra window or document listener', `${down1.probe.listenerTotal} -> ${down2.probe.listenerTotal}`);
  check(down2.probe.fetchesOpen === 0 && down1.probe.fetchesOpen === 0, 'it leaves no request in flight', `${down1.probe.fetchesOpen} then ${down2.probe.fetchesOpen}`);
  check(down2.lifecycle.live === 0, 'it leaves no grid alive', `${down2.lifecycle.live}`);
  check(down2.lifecycle.created === down2.lifecycle.destroyed, 'and the ledger balances again', `${down2.lifecycle.created} built, ${down2.lifecycle.destroyed} destroyed`);
  check(down2.appChildren === 0, 'and no DOM is left behind', `${down2.appChildren}`);
  noErrors('development, after the whole cycle');

  await devServer.close();
  devServer = null;

  /* =================================================================== */
  /* 2. The built site: the deployment gate.                             */
  /* =================================================================== */

  await open(`${distOrigin}${BASE}?source=snapshot`, 'the built site, saved copy');

  const built = await evaluate(READ_STATE);
  console.log(`  ${built.rows} rows, ${built.columns} columns, ${built.painted} painted, ${built.charts} charts`);
  console.log(`  tiles: ${JSON.stringify(built.tiles)}`);
  console.log(`  chart marks: ${JSON.stringify(built.marks)}`);

  check(built.rows > 0, 'built: the table holds rows', `${built.rows}`);
  check(built.painted > 0, 'built: the table painted rows', `${built.painted}`);
  check(built.charts === 4, 'built: all four charts were built', `${built.charts}`);
  check(built.watermark === false, 'built: no watermark on localhost', `state ${built.licenceState}`);
  /* Built is not drawn. A chart whose points all carry a null measure puts an
     empty pair of axes on the page and reports no error. */
  built.withValue.forEach((n, i) => {
    check(n > 0, `built: chart ${i} plotted values rather than empty axes`, `${n} points carry a measure`);
    check(built.marks[i] > 2, `built: chart ${i} drew marks`, `${built.marks[i]} marks`);
  });
  check(/^M\d/.test(built.named), 'built: the largest earthquake is named', built.named);
  noErrors('built');
  await shoot('04-built-saved-copy');

  /* The independent recomputation: the saved rows, shifted the same way the
     page shifted them, reduced here in Node. */
  const shifted = savedRows.map((row) => ({ ...row, time: row.time + built.shiftMs }));
  const now = Date.now();
  const strictSet = shifted.filter((row) => now - row.time <= WINDOW_MS);
  const slackSet = shifted.filter((row) => now - row.time <= WINDOW_MS + SLACK_MS);
  const maxMag = (list) => list.reduce((m, r) => (typeof r.mag === 'number' && r.mag > m ? r.mag : m), -Infinity);
  const expectedNotable24 = shifted.filter(
    (row) => typeof row.mag === 'number' && row.mag >= NOTABLE_MAG && row.time >= now - DAY_MS,
  ).length;

  check(
    built.tiles.events >= strictSet.length && built.tiles.events <= slackSet.length,
    'built: the event count matches the saved feed',
    `tile ${built.tiles.events}, expected between ${strictSet.length} and ${slackSet.length}`,
  );
  check(
    built.tiles.largest >= maxMag(strictSet) - 1e-9 && built.tiles.largest <= maxMag(slackSet) + 1e-9,
    'built: the largest magnitude matches the saved feed',
    `tile ${built.tiles.largest}, expected between ${maxMag(strictSet)} and ${maxMag(slackSet)}`,
  );
  check(
    built.tiles.notable24 === expectedNotable24,
    `built: the M${NOTABLE_MAG}+ in 24 hours count matches the saved feed`,
    `tile ${built.tiles.notable24}, expected ${expectedNotable24}`,
  );
  const newest = shifted.reduce((m, r) => (r.time > m ? r.time : m), 0);
  const expectedSince = Math.round((now - newest) / 60000);
  check(
    Math.abs(built.tiles.sinceLatest - expectedSince) <= 2,
    'built: minutes since the latest event matches the saved feed',
    `tile ${built.tiles.sinceLatest}, expected about ${expectedSince}`,
  );

  /* ---- a revision lands on the row it belongs to ---- */

  const revision = await evaluate(`(async () => {
    const d = window.__quakeDemo;
    let target = null;
    d.allGrid.rows.forEach((r) => { if (!target && r && r.data && typeof r.data.mag === 'number') target = r.data; });
    const before = { count: d.allGrid.rows.count(), id: target.id, mag: target.mag };
    d.ingest([{ ...target, mag: Number((target.mag + 1.7).toFixed(1)), updated: target.updated + 1000 }]);
    await new Promise((r) => setTimeout(r, 500));
    let found = null;
    d.allGrid.rows.forEach((r) => { if (r && r.data && r.data.id === before.id) found = r.data; });
    return { before, after: { count: d.allGrid.rows.count(), mag: found ? found.mag : null }, expected: Number((before.mag + 1.7).toFixed(1)) };
  })()`);
  console.log(`  revision: ${revision.before.id} M${revision.before.mag} -> M${revision.after.mag}, rows ${revision.before.count} -> ${revision.after.count}`);
  check(revision.after.count === revision.before.count, 'built: a revision updates the row rather than adding one', `${revision.before.count} -> ${revision.after.count}`);
  check(revision.after.mag === revision.expected, 'built: the revised magnitude is on the row', `expected ${revision.expected}, found ${revision.after.mag}`);

  /* ---- a stale revision is dropped ---- */

  const ordering = await evaluate(`(async () => {
    const d = window.__quakeDemo;
    let target = null;
    d.allGrid.rows.forEach((r) => { if (!target && r && r.data && typeof r.data.mag === 'number') target = r.data; });
    const held = { id: target.id, mag: target.mag, updated: target.updated };
    const droppedBefore = d.router.dropped || 0;
    d.router.apply([{ op: 'upsert', row: { ...target, mag: 0.1, updated: held.updated - 60000 } }]);
    await new Promise((r) => setTimeout(r, 400));
    let found = null;
    d.allGrid.rows.forEach((r) => { if (r && r.data && r.data.id === held.id) found = r.data; });
    return { held, mag: found ? found.mag : null, dropped: (d.router.dropped || 0) - droppedBefore };
  })()`);
  check(ordering.mag === ordering.held.mag, 'built: an out of order revision does not undo a correction', `magnitude stayed ${ordering.mag}`);
  check(ordering.dropped >= 1, 'built: the router counted the stale revision it dropped', `${ordering.dropped}`);

  /* ---- the rolling window drops what is too old, and keeps what is not ---- */

  const window7 = await evaluate(`(async () => {
    const d = window.__quakeDemo;
    const now = Date.now();
    const WINDOW = 7 * 24 * 60 * 60 * 1000;
    const base = { updated: now, magType: 'ml', place: 'Window check', depth: 10, lat: 0, lng: 0,
      alert: 'none', tsunami: false, felt: null, cdi: null, mmi: null, sig: 1, net: 'zz',
      status: 'automatic', kind: 'earthquake', url: null, significant: false, count: 1 };
    const held = (id) => !!d.allGrid.rows.byKey(id);
    d.ingest([
      { ...base, id: 'window-check-fresh', mag: 3.1, time: now - 60000, day: '' },
      { ...base, id: 'window-check-expiring', mag: 3.2, time: now - WINDOW + 3000, day: '' },
    ]);
    await new Promise((r) => setTimeout(r, 250));
    const admitted = { fresh: held('window-check-fresh'), expiring: held('window-check-expiring') };
    const totalBefore = d.allGrid.rows.totalCount();
    await new Promise((r) => setTimeout(r, 4000));
    const dropped = d.pruneWindow();
    await new Promise((r) => setTimeout(r, 400));
    return {
      admitted,
      settled: { fresh: held('window-check-fresh'), expiring: held('window-check-expiring') },
      dropped,
      totalBefore,
      totalAfter: d.allGrid.rows.totalCount(),
    };
  })()`);
  console.log(`  window: admitted ${JSON.stringify(window7.admitted)}, after crossing ${JSON.stringify(window7.settled)}, dropped ${window7.dropped}, total ${window7.totalBefore} -> ${window7.totalAfter}`);
  check(window7.admitted.fresh && window7.admitted.expiring, 'built: the window admits both rows while both are inside it', JSON.stringify(window7.admitted));
  check(window7.settled.expiring === false && window7.dropped >= 1, 'built: the rolling window drops an event once it passes seven days', `${window7.dropped} dropped`);
  check(window7.settled.fresh === true, 'built: the rolling window keeps the event that is still inside it');
  check(window7.totalAfter < window7.totalBefore, 'built: the dropped event leaves the table', `${window7.totalBefore} -> ${window7.totalAfter}`);

  /* ---- grouping ---- */

  const grouped = await evaluate(`(async () => {
    const d = window.__quakeDemo;
    d.allGrid.columns.group(['alert']);
    await new Promise((r) => setTimeout(r, 800));
    let groups = 0;
    d.allGrid.rows.forEach((r) => { if (r && r.group) groups += 1; });
    const created = d.lifecycle.created;
    d.allGrid.columns.group([]);
    await new Promise((r) => setTimeout(r, 500));
    return { groups, created };
  })()`);
  check(grouped.groups > 0, 'built: grouping by PAGER alert produces group rows', `${grouped.groups} groups`);
  noErrors('built, after the checks');

  /* =================================================================== */
  /* 3. What a visitor gets when the USGS feeds cannot be reached.       */
  /* =================================================================== */

  await call('Network.enable');
  await call('Network.setBlockedURLs', { urls: ['*earthquake.usgs.gov*'] });
  await open(`${distOrigin}${BASE}`, 'the built site, with the feeds unreachable');
  const fallback = await evaluate(`(() => {
    const d = window.__quakeDemo;
    const notice = document.querySelector('.notice');
    const pill = document.querySelector('.head-note .pill');
    const freshness = document.querySelector('.freshness');
    return {
      rows: d.allGrid.rows.totalCount(),
      painted: document.querySelectorAll('.lattice [role="row"]').length,
      fellBack: !!(d.timings && d.timings.fellBack),
      mode: d.timings && d.timings.mode,
      badge: pill ? pill.textContent.trim() : null,
      notice: notice ? notice.textContent.trim() : null,
      savedOnShown: freshness ? /saved on/i.test(freshness.textContent) : false,
      live: !!d.meta.live,
    };
  })()`);
  console.log(`  rows ${fallback.rows}, badge "${fallback.badge}", fell back: ${fallback.fellBack}`);
  console.log(`  notice: ${fallback.notice}`);
  check(fallback.rows > 0, 'fallback: the saved copy is on screen', `${fallback.rows} rows`);
  check(fallback.painted > 0, 'fallback: the table painted rows', `${fallback.painted}`);
  check(fallback.fellBack, 'fallback: the page recorded that it fell back to the saved copy');
  check(fallback.mode === 'live', 'fallback: the page ran in the live default, not snapshot mode', `mode ${fallback.mode}`);
  check(fallback.badge === 'Saved copy', 'fallback: the badge reads "Saved copy"', `"${fallback.badge}"`);
  check(!!fallback.notice && /could not be reached/i.test(fallback.notice), 'fallback: the page says the feeds were unreachable', fallback.notice);
  check(fallback.savedOnShown, "fallback: the saved copy's date is shown");
  check(!fallback.live, 'fallback: no poll is started against feeds that could not be reached');
  check(pageErrors.length === 0, 'fallback: no page errors', pageErrors.slice(0, 3).join(' | '));
  await shoot('05-fallback');
  await call('Network.setBlockedURLs', { urls: [] });

  /* =================================================================== */
  /* 4. The same dashboard, built the plain way, must agree.             */
  /* =================================================================== */

  if (compareDir) {
    const plain = await startPlain(compareDir);
    plainServer = plain.server;
    const plainOrigin = `http://127.0.0.1:${plain.port}`;
    await open(`${plainOrigin}/index.html?source=snapshot`, 'the plain-JavaScript edition, saved copy');
    const other = await evaluate(READ_STATE);
    console.log(`  ${other.rows} rows, ${other.columns} columns, ${other.charts} charts`);
    console.log(`  tiles: ${JSON.stringify(other.tiles)}`);
    console.log(`  chart marks: ${JSON.stringify(other.marks)}`);

    console.log('\n  React against plain:');
    const row = (what, a, b, ok) => {
      console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${what.padEnd(28)} React ${String(a).padEnd(12)} plain ${b}`);
    };
    const same = (what, a, b) => {
      const ok = a === b;
      row(what, a, b, ok);
      check(ok, `the two editions agree on ${what}`, `React ${a}, plain ${b}`);
    };
    const near = (what, a, b, tolerance) => {
      const ok = Math.abs(a - b) <= tolerance;
      row(what, a, b, ok);
      check(ok, `the two editions agree on ${what}`, `React ${a}, plain ${b}, tolerance ${tolerance}`);
    };

    same('rows in the table', built.rows, other.rows);
    same('visible columns', built.columns, other.columns);
    same('charts built', built.charts, other.charts);
    same('earthquakes in the window', built.tiles.events, other.tiles.events);
    same('largest magnitude', built.tiles.largest, other.tiles.largest);
    same(`M${NOTABLE_MAG}+ in 24 hours`, built.tiles.notable24, other.tiles.notable24);
    near('minutes since the latest', built.tiles.sinceLatest, other.tiles.sinceLatest, 2);
    same('the largest named', built.named, other.named);
    for (let i = 0; i < 4; i += 1) same(`chart ${i} marks`, built.marks[i], other.marks[i]);
    for (let i = 0; i < 4; i += 1) same(`chart ${i} points with a value`, built.withValue[i], other.withValue[i]);
    noErrors('the plain edition');
    await shoot('06-plain-edition');
  }

  socket.close();
} catch (error) {
  failures.push(String((error && error.stack) || error));
} finally {
  /* Take the whole browser tree down, not just the process that was spawned:
     a surviving renderer is an orphan nobody will reap. */
  if (browserPid) {
    try { process.kill(-browserPid, 'SIGKILL'); } catch {}
    try { process.kill(browserPid, 'SIGKILL'); } catch {}
  }
  if (devServer) { try { await devServer.close(); } catch {} }
  if (distServer) distServer.close();
  if (plainServer) plainServer.close();
  await sleep(400);
  if (profile) await rm(profile, { recursive: true, force: true });
}

/**
 * Serve another copy of this demo from its own directory, read only, so the
 * two editions can be put side by side in the same browser.
 */
async function startPlain(dir) {
  const { createServer } = await import('node:http');
  const { createReadStream } = await import('node:fs');
  const { stat } = await import('node:fs/promises');
  const { extname, join: joinPath, normalize } = await import('node:path');
  const base = resolve(dir);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
  };
  const server = createServer(async (request, response) => {
    const decoded = decodeURIComponent((request.url || '/').split('?')[0]);
    let file = joinPath(base, normalize(decoded).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(base)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      let info = await stat(file);
      if (info.isDirectory()) {
        file = joinPath(file, 'index.html');
        info = await stat(file);
      }
      response.writeHead(200, {
        'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
      });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port }));
  });
}

console.log('\nChecks:');
for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${notes.length} checks passed.`);
process.exit(0);
