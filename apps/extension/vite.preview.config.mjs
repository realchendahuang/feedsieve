import { fileURLToPath, URL } from 'node:url';

const extensionRoot = fileURLToPath(new URL('.', import.meta.url));

const nodeStub = fileURLToPath(new URL('./preview/node-stub.ts', import.meta.url));
export default {
  root: fileURLToPath(new URL('./preview', import.meta.url)),
  // keyword-packs.ts 顶部引入 node:fs / node:path（仅 vitest 分支使用）；
  // vite dev 会把它们外置成访问即抛错的模块，预览页因此白屏。WXT 正式构建另有处理。
  resolve: {
    alias: { 'node:fs': nodeStub, 'node:path': nodeStub },
  },
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
