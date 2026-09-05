import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    // The API is a separate origin (Rikta on :4000). Proxying in development
    // keeps the browser same-origin, so the session cookie is sent without
    // CORS preflight or SameSite=None — which would otherwise force
    // Secure-only cookies and break plain http://localhost.
    proxy: {
      "/v1": { target: "http://127.0.0.1:4000", changeOrigin: true },
      "/api/auth": { target: "http://127.0.0.1:4000", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:4000", changeOrigin: true },
    },
  },
});
