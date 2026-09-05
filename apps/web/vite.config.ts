import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Where the API lives.
 *
 * Overridable so an end-to-end run can start its own API on a free port
 * without colliding with a dev server already on 4000.
 */
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    // The API is a separate origin (Rikta on :4000). Proxying in development
    // keeps the browser same-origin, so the session cookie is sent without
    // CORS preflight or SameSite=None — which would otherwise force
    // Secure-only cookies and break plain http://localhost.
    proxy: {
      "/v1": { target: apiTarget, changeOrigin: true },
      "/api/auth": { target: apiTarget, changeOrigin: true },
      "/health": { target: apiTarget, changeOrigin: true },
    },
  },
});
