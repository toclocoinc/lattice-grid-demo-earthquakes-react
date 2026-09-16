/**
 * The application: work out where the data should come from, and then get out
 * of the way.
 */

import { useEffect } from 'react';
import { Dashboard } from './Dashboard.jsx';
import { Failed, Loading } from './components/Loading.jsx';
import { useQuakeSource } from './hooks/useQuakeSource.js';

export function App() {
  const source = useQuakeSource();

  /* Said before the dashboard exists, so a check that opens the page knows the
     difference between "still loading" and "failed". The dashboard replaces it
     with the live one as soon as it is on screen. */
  useEffect(() => {
    if (source.phase === 'failed') {
      window.__quakeDemo = { ready: false, error: String(source.error?.message || source.error) };
    } else if (source.phase === 'loading' && !window.__quakeDemo) {
      window.__quakeDemo = { ready: false, error: null, loading: true };
    }
  }, [source.phase, source.error]);

  if (source.phase === 'loading') {
    return <Loading message={source.message} progress={source.progress} />;
  }
  if (source.phase === 'failed') {
    return <Failed error={source.error} />;
  }

  return (
    <Dashboard
      rows={source.rows}
      replayRows={source.replayRows}
      meta={source.meta}
      significantIds={source.significantIds}
      mode={source.mode}
      fetchMs={source.fetchMs}
    />
  );
}
