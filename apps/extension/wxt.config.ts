import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import rootPackage from '../../package.json' with { type: 'json' };

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    define: {
      __ONE_VEGETABLE_EXTENSION__: 'true',
      'import.meta.env.VITE_APP_RUNTIME': JSON.stringify('extension')
    },
    plugins: [tailwindcss()]
  }),
  hooks: {
    'vite:build:extendConfig'(entrypoints, config) {
      // Only the ESM group can split modules. Content scripts stay single-file.
      if (!entrypoints.some((entry) => entry.type === 'background')) return;
      config.build ??= {};
      config.build.rollupOptions ??= {};
      const output = config.build.rollupOptions.output;
      if (Array.isArray(output)) throw new Error('Expected one MV3 ESM output');
      config.build.rollupOptions.output = {
        ...output,
        manualChunks(id) {
          const match =
            /\/generated\/(validators-(?:product|rfq|trade|logistics|insights|photo|platform))\.ts$/.exec(
              id.replaceAll('\\', '/')
            );
          return match?.[1];
        }
      };
    }
  },
  manifest: {
    name: '__MSG_extName__',
    version: rootPackage.version,
    description: '__MSG_extDescription__',
    default_locale: 'zh_CN',
    minimum_chrome_version: '102',
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://eco.taobao.com/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: '__MSG_extName__',
      default_icon: { 16: 'icon.png', 32: 'icon.png', 48: 'icon.png', 128: 'icon.png' }
    },
    icons: { 16: 'icon.png', 32: 'icon.png', 48: 'icon.png', 128: 'icon.png' },
    homepage_url: 'https://github.com/OKFred/oneVegetable',
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'"
    }
  }
});
