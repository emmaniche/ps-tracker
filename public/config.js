// Shared backend (Neon Postgres, served by the same Netlify site as a function
// at /api/*). An empty apiBase means same-origin. The tracker runs in server
// mode only: records and files are never written to this browser's IndexedDB.
// requireServer makes a failed connection an error instead of silently falling
// back to local storage.
window.APP_CONFIG = {
  apiBase: '',
  requireServer: true
};
