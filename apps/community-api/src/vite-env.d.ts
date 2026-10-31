/// <reference types="vite/client" />

// Vite 资产导入类型声明
declare module '@resvg/resvg-wasm/index_bg.wasm?module' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
