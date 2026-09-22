// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/** three / 3d-force-graph read `window.THREE` at module scope. They are only ever
 *  loaded client-side (lazy import in src/routes/brain.tsx), but Rollup used to
 *  merge them into the same vendor chunk as the unenv polyfills that SSR imports,
 *  which crashed every server-rendered page with "window is not defined".
 *  Keeping them in a dedicated chunk means the server never evaluates them. */
const BROWSER_ONLY_3D =
  /node_modules\/(three|three-spritetext|three-render-objects|3d-force-graph|react-force-graph-3d|force-graph|kapsule|accessor-fn)\//;

export default defineConfig({
  // Self-hosted deploys (Docker/GKE) need a Node server, not the Lovable
  // Cloudflare default. Produces .output/server/index.mjs via `vite build`.
  nitro: { preset: "node-server" },
  vite: {
    build: {
      rollupOptions: {
        output: {
          // Rolldown grouping (Vite 8): keep the browser-only 3D stack isolated
          // so it never shares a chunk with modules the server imports.
          advancedChunks: {
            groups: [{ name: "browser-3d", test: BROWSER_ONLY_3D, priority: 100 }],
          },
        },
      },
    },
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
