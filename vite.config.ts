import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Marks are read and written by Lean rather than by this dev server:
    // `trust serve-marks` owns `trust-marks.json` — it is the side that can
    // compute a content hash — and answers `/api/marks` on :8123.  Proxying to
    // it rather than embedding a middleware here keeps the frontend a plain
    // static site, so the bundle served in development is the one deployed.
    //
    // With nothing listening the proxy fails the request, which is exactly
    // what the frontend already treats as "not editable": a deployed index has
    // no marks API either, and shows the exported marks read-only.
    proxy: {
      // Order matters: the first matching prefix wins, and marks are served by
      // a different process from the node.
      '/api/marks': {
        target: 'http://127.0.0.1:8123',
        changeOrigin: true,
      },
      // The node.  With no `VITE_TRUST_SERVER` the page treats its own origin
      // as the node — which in development is this dev server — so `/api` and
      // `/auth` go to a node running locally; `trust-server`'s local mode
      // listens on 8090.  With nothing there the requests fail, the server
      // picker says so, and the lists come back empty, which is the honest
      // rendering of "no node" rather than a hidden UI.
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
      },
    },
  },
})
