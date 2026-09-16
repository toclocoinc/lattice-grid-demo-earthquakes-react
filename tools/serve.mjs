/**
 * A small static file server for the built demo.
 *
 * It serves `dist/`, which is what actually gets published, rather than the
 * sources. `npm run dev` is the development server; this is for looking at,
 * and checking, the thing that ships.
 *
 * The built page asks for its assets under the base path GitHub Pages serves
 * it from, so that prefix is accepted and stripped. The same URL therefore
 * works here and in production without the page knowing the difference.
 *
 * It takes a free port from the operating system and prints the address, so it
 * never clashes with anything else already running. Pass a port as the first
 * argument to choose one yourself.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = join(project, 'dist');

/** The path the site is published under; it must match `base` in vite.config.js. */
export const BASE = '/lattice-grid-demo-earthquakes-react/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Resolve a request path to a file inside `dist`, or null when it points
 * outside it.
 */
function resolvePath(urlPath) {
  let decoded = decodeURIComponent(urlPath.split('?')[0]);
  if (decoded.startsWith(BASE)) decoded = `/${decoded.slice(BASE.length)}`;
  else if (`${decoded}/` === BASE) decoded = '/';
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = join(root, relative);
  if (!full.startsWith(root)) return null;
  return full;
}

export function startServer(port = 0) {
  const server = createServer(async (request, response) => {
    let file = resolvePath(request.url || '/');
    if (!file) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      let info = await stat(file);
      if (info.isDirectory()) {
        file = join(file, 'index.html');
        info = await stat(file);
      }
      response.writeHead(200, {
        'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
      });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });

  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => done({ server, port: server.address().port }));
  });
}

/* Run directly, rather than imported by the verification script. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const wanted = Number(process.argv[2] || 0);
  const { port } = await startServer(Number.isFinite(wanted) ? wanted : 0);
  process.stdout.write(`Serving the built demo at http://localhost:${port}${BASE}\n`);
  process.stdout.write(`The saved copy is at http://localhost:${port}${BASE}?source=snapshot\n`);
  process.stdout.write('Press Control-C to stop.\n');
}
