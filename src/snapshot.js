/**
 * The saved copy that ships with the demo.
 *
 * It is read from `BASE_URL` rather than from a path of its own, because the
 * page is served from the repository root in development and from the project
 * subpath once published. Vite substitutes the value at build time, so the
 * same line works in both places without the app knowing where it is.
 */

const BASE = import.meta.env.BASE_URL;

/**
 * Read the saved rows and the note saying when they were taken.
 *
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{rows: object[], meta: object}>}
 */
export async function loadSnapshot(opts = {}) {
  const [quakes, meta] = await Promise.all(
    ['quakes', 'meta'].map(async (name) => {
      const response = await fetch(`${BASE}data/snapshot/${name}.json`, { signal: opts.signal });
      if (!response.ok) throw new Error(`The saved copy is missing ${name}.json.`);
      return response.json();
    }),
  );
  return { rows: quakes, meta: { ...meta, live: false } };
}
