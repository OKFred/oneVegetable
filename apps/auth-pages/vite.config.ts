import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [
    {
      name: 'canonical-callback-development',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url?.split('?')[0] === '/callback')
            request.url = request.url.replace('/callback', '/callback.html');
          next();
        });
      }
    }
  ],
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        callback: resolve(import.meta.dirname, 'callback.html')
      }
    }
  }
});
