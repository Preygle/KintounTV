import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { UPSTREAM_BASE, UPSTREAM_HEADERS } from "./upstream.mjs";
import { handleApiList, handleStream } from "./stream.mjs";
import pkg from "./package.json";

const upstream = new URL(UPSTREAM_BASE);

export default defineConfig({
  // The running app's version, compared with the latest GitHub release (src/updates.ts).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    {
      name: "kintoun-stream",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          handleStream(req, res).then((handled) => handled || next(), next);
        });
        // GET /api/list?ids= -> upstream POST (the dev proxy can't change method/body).
        server.middlewares.use((req, res, next) => {
          handleApiList(req, res).then((handled) => handled || next(), next);
        });
      },
    },
  ],
  server: {
    proxy: {
      "/api": {
        target: upstream.origin,
        changeOrigin: true,
        headers: UPSTREAM_HEADERS,
      },
    },
  },
});
