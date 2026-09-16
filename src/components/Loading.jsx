const TITLE = 'Earthquakes around the world, as they are recorded';

/** The waiting state. */
export function Loading({ message, progress }) {
  return (
    <div className="loading">
      <h1>{TITLE}</h1>
      <p className="loading-message">{message}</p>
      <div className="loading-bar">
        <div className="loading-fill" style={{ width: `${Math.round((progress || 0) * 100)}%` }} />
      </div>
    </div>
  );
}

/** Say what went wrong, in words a reader can act on. */
export function Failed({ error }) {
  return (
    <div className="loading">
      <h1>The earthquake data could not be loaded</h1>
      <p className="loading-message">{String((error && error.message) || error)}</p>
      <p className="loading-message">
        You can open the same dashboard from the saved copy by adding ?source=snapshot to the
        address.
      </p>
    </div>
  );
}
