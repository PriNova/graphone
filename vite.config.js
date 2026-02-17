import { defineConfig, searchForWorkspaceRoot } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;
const workspaceRoot = searchForWorkspaceRoot(process.cwd());
const webSrcPath = resolve(process.cwd(), "apps/desktop/web/src");
const webStaticPath = resolve(process.cwd(), "apps/desktop/web/static");

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    sveltekit(),
    tailwindcss(),
  ],
  build: {
    target: 'esnext',
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    fs: {
      // Allow serving symlink target paths after repo restructure.
      // SvelteKit resolves modules through `src -> apps/desktop/web/src`,
      // which may otherwise be blocked as outside the default allow list.
      allow: [workspaceRoot, webSrcPath, webStaticPath],
    },
  },
}));
