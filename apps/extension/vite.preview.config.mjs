import { fileURLToPath, URL } from 'node:url';

const extensionRoot = fileURLToPath(new URL('.', import.meta.url));

export default {
  root: fileURLToPath(new URL('./preview', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 4178,
    strictPort: true,
    fs: {
      allow: [extensionRoot, fileURLToPath(new URL('../..', import.meta.url))],
    },
  },
};
