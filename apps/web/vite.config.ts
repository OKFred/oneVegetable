import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __ONE_VEGETABLE_EXTENSION__: 'false',
    'import.meta.env.VITE_APP_RUNTIME': JSON.stringify('web')
  },
  plugins: [vue(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // Keep each bilingual catalog independently bounded without duplicating the runtime.
              name: 'i18n-messages-zh-CN',
              test: /ui[\\\\/]src[\\\\/]i18n[\\\\/]messages[\\\\/]zh-CN[\\\\/]/u,
              includeDependenciesRecursively: false
            },
            {
              name: 'i18n-messages-en-US',
              test: /ui[\\\\/]src[\\\\/]i18n[\\\\/]messages[\\\\/]en-US[\\\\/]/u,
              includeDependenciesRecursively: false
            },
            {
              // Historical notes belong to the lazy release page, not the eager catalogs.
              name: 'release-notes',
              test: /core[\\/]src[\\/](?:generated[\\/])?release-notes\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              // Keep the translation runtime separate from the growing bilingual catalogs.
              name: 'i18n-runtime',
              test: /node_modules[\\/](?:vue-i18n|@intlify)[\\/]/u
            },
            {
              name: 'core-validation',
              test: /(?:validators-core|node_modules[\\/]ajv-i18n)/u
            },
            {
              name: 'html-contract',
              test: /(?:node_modules[\\/](?:parse5|entities)|core[\\/]src[\\/]product-description)/u
            },
            {
              name: 'capability-contracts',
              test: /core[\\/]src[\\/]generated[\\/].*capabilities/u
            }
          ]
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: { port: 5173 }
});
