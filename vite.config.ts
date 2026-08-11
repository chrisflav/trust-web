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
      '/api/marks': {
        target: 'http://127.0.0.1:8123',
        changeOrigin: true,
      },
    },
  },
})
