import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config for the web package.
//
// `/api` proxy points at the local Fastify dev server so the React
// app can call `fetch("/api/workflows")` without CORS gymnastics.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
