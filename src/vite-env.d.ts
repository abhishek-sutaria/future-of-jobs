/// <reference types="vite/client" />

// Vite asset URL imports (e.g. import x from 'foo?url')
declare module '*?url' {
    const src: string;
    export default src;
}

interface ImportMetaEnv {
    readonly VITE_BLS_API_KEY: string;
    readonly VITE_HAS_DEFAULT_CLAUDE_KEY: boolean;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
