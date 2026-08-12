import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Dev proxies /api to the Bun server; production build lands in web/dist,
// served by the same Bun process. Port 4321 mirrors server/index.ts.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4321" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
