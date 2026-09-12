import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    // 顺序按 TanStack Start 官方指南：cloudflare → tanstackStart → react
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
});
