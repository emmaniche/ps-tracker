// Shared backend (Neon Postgres + Object Storage, served by Render).
// The tracker runs in server mode only: records and files are never written
// to this browser's IndexedDB. requireServer makes a failed connection an
// error instead of silently falling back to local storage.
window.APP_CONFIG = {
  apiBase: 'https://process-safety-tracker.onrender.com',
  requireServer: true
};
