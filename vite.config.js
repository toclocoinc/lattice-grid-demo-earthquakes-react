import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The build.
 *
 * `base` is the path the site is published under on GitHub Pages. It is what
 * makes the asset URLs in the built `index.html` resolve, and it is also what
 * `import.meta.env.BASE_URL` gives the app, so the saved copy is fetched from
 * the right place whether the page is served from the repository root in
 * development or from the project subpath once published.
 */
export default defineConfig({
  base: '/lattice-grid-demo-earthquakes-react/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    /* The saved copy is a shipped artefact, not a build input, and it is the
       largest thing on the page. Nothing is gained by inlining any of it. */
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
