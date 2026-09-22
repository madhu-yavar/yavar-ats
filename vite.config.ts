// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

import { fileURLToPath } from "node:url";

/** three / three-spritetext / react-force-graph-3d read `window.THREE` while they
 *  are being evaluated. They are only ever rendered in the browser (lazy import in
 *  src/routes/brain.tsx), but the server bundler still pulled them in and merged
 *  them with modules the server imports, which crashed every server-rendered page
 *  with "window is not defined". Resolve them to an inert stub on the server only. */
const BROWSER_ONLY_3D = new Set(["three", "three-spritetext", "react-force-graph-3d"]);
const BROWSER_3D_STUB = fileURLToPath(new URL("./src/stubs/browser-3d-stub.ts", import.meta.url));

export default defineConfig({
  // Self-hosted deploys (Docker/GKE) need a Node server, not the Lovable
  // Cloudflare default. Produces .output/server/index.mjs via `vite build`.
  nitro: { preset: "node-server" },
  vite: {
    plugins: [
      {
        name: "atsiq-stub-browser-3d-on-server",
        enforce: "pre" as const,
        resolveId(source: string, _importer: string | undefined, options: { ssr?: boolean }) {
          if (options?.ssr && BROWSER_ONLY_3D.has(source)) return BROWSER_3D_STUB;
          return null;
        },
      },
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // TEMPORARY (local e2e): *.functions.ts import src/server/db at module
    // scope; mock ONLY the node-only modules (db/storage) in the dev client —
    // their mocks are never invoked client-side because handlers and
    // middleware .server() bodies only run on the server. Auth middleware
    // (src/lib/auth.middleware.ts) stays real so the server-fn compiler can
    // introspect .middleware([...]) arrays without hitting a mock.
    importProtection: {
      // build:"mock" too — the production client bundle keeps server-fn/middleware
      // module-graph references, and without it `vite build` errors exactly like
      // dev did. Mocks are never invoked client-side (only .server() bodies run).
      behavior: { dev: "mock", build: "mock" },
      client: { files: ["**/server/db.ts", "**/server/storage.ts"] },
    },
  },
});
