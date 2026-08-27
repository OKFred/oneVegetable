import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
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
