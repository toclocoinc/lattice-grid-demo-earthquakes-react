/**
 * The entry point.
 *
 * Two things happen here that happen nowhere else: the licence is applied, and
 * React is given the page.
 *
 * `setLicence` runs before anything is rendered, because a grid that already
 * exists keeps whatever licence was in force when it was built. It is called
 * once, at module scope, rather than from an effect: an effect would run after
 * the first grid had already been created, and in StrictMode it would run
 * twice.
 *
 * `React.StrictMode` is on, and is meant to be. It mounts every component
 * twice in development on purpose, which is the harshest test there is of a
 * wrapper around something that owns DOM and timers. A grid that survives it
 * is a grid whose React lifecycle is right; one that does not shows up as two
 * tables, a doubled poll, or a chart drawn against a grid that no longer
 * exists. It costs nothing in the built page: StrictMode's double mount is a
 * development-only behaviour.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@toclocoinc/lattice-grid/css';
import './styles.css';
import { App } from './App.jsx';
import { DEMO_LICENCE } from './licence.js';
import { getVersion, lifecycle, setLicence } from './lattice.js';

setLicence(DEMO_LICENCE);

const host = document.querySelector('#app');
let root = null;
let shell = null;

/**
 * Put the application on the page.
 *
 * React is given a container of its own rather than `#app` itself, and a fresh
 * one each time. A root owns its container: handing the same element to
 * `createRoot` twice is a mistake React is entitled to complain about, and a
 * container React created nothing in is the only way to say, afterwards, that
 * nothing was left behind.
 */
function mount() {
  if (root) return root;
  shell = document.createElement('div');
  shell.className = 'shell';
  host.append(shell);
  root = createRoot(shell);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return root;
}

/**
 * Take it off again.
 *
 * Exposed because this edition's claim is that React's teardown leaves nothing
 * behind — no grid, no listener, no timer, no request in flight — and a claim
 * like that is only worth making if it can be run.
 */
function unmount() {
  if (!root) return;
  root.unmount();
  root = null;
  if (shell) shell.remove();
  shell = null;
  window.__quakeDemo = { ready: false, error: null, unmounted: true, lifecycle };
}

window.__quakeDemoApp = { mount, unmount, lifecycle, version: getVersion() };

mount();
