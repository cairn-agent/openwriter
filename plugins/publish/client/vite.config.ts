// The publish plugin's screens as one ES module (dist/client/site.js), served by OpenWriter as
// the plugin's clientModule. It brings its own React: client modules mount their own roots.
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@openwriter-src': here('../../../packages/openwriter/src') },
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: here('../dist/client'),
    emptyOutDir: true,
    minify: true,
    lib: { entry: here('./index.tsx'), formats: ['es'], fileName: () => 'site.js' },
  },
});
