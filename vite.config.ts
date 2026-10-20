// Self-hosted build: TanStack Start on Cloudflare Workers (replaces @lovable.dev/vite-tanstack-config).
// The Cloudflare plugin runs the server in the real Workers runtime in dev and build, which the
// Twilio voice stream needs (it uses WebSocketPair).
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { port: 3000 },
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({
      // src/server.ts wraps the default server entry with the SSR error page and waitUntil support.
      server: { entry: "server" },
    }),
    viteReact(),
  ],
});
