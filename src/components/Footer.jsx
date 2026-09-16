/** The credit line. */
export function Footer() {
  return (
    <footer className="foot">
      <p>
        {'Earthquake data from the '}
        <a
          href="https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php"
          rel="noopener"
        >
          United States Geological Survey earthquake feeds
        </a>
        {'. USGS data are in the public domain and free to use. Times are shown in your own time ' +
          'zone alongside UTC, which is what USGS publishes. Early readings are automatic and are ' +
          'revised by a reviewer, so a magnitude here may change.'}
      </p>
    </footer>
  );
}
