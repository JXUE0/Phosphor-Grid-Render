import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/Phosphor-Grid-Render/' : '/',
  server: {
    port: 5100
  }
});