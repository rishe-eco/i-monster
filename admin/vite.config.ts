// The admin bundle's build (plan B4b, PD-21). The server renders its pages with
// no build; only this is built. It writes one script and one stylesheet under
// fixed names, with no code splitting and no Vite hashes: lib/assets.ts hashes
// them when the server starts, like every other asset, so there is one scheme.
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  // No public directory and no index.html: the server writes the page.
  publicDir: false,
  // Vite's own JSX transform, pointed at Preact: no preset, no plugin.
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  // lib/dates.ts defaults its time zone from lib/env.ts, which reads `process.env`.
  // The bundle always passes the zone it was given, so an empty environment is right.
  define: { 'process.env': '{}' },
  build: {
    outDir: '../dist/admin',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: 'main.tsx',
      output: {
        format: 'es',
        entryFileNames: 'admin.js',
        assetFileNames: 'admin[extname]',
        codeSplitting: false,
      },
    },
  },
});
