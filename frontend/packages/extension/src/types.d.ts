// Build-time injected globals from vite.config.ts. Declared here so TS doesn't
// complain when these are referenced anywhere in the extension source.

declare const __BACKEND_URL__: string;
declare const __DEV__: boolean;
