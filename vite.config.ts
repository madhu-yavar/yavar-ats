// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
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
      behavior: { dev: "mock" },
      client: { files: ["**/server/db.ts", "**/server/storage.ts"] },
    },
  },
});
