'use client';

import { useEffect, useState } from 'react';

type Dataset = { id: string; name: string; as_of: string; licence: string; demo: boolean };

/** Live data sources and licences from the public health endpoint, with a static fallback. */
export function AboutDatasets() {
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch('/api/v1/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((h) => setDatasets(h.datasets ?? []))
      .catch(() => setFailed(true));
  }, []);
  if (failed) return <p>The data sources are listed in the app once it loads.</p>;
  if (!datasets) return <p>Loading data sources…</p>;
  if (!datasets.length) return <p>No datasets are loaded in this deployment yet.</p>;
  return (
    <ul className="about-datasets">
      {datasets.map((d) => (
        <li key={d.id}>
          <strong>{d.name}</strong>
          <span>As of {d.as_of} · {d.licence}{d.demo ? ' · Demo data' : ''}</span>
        </li>
      ))}
    </ul>
  );
}
