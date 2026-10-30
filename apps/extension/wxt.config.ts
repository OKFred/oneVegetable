import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import rootPackage from '../../package.json' with { type: 'json' };
import { extensionValidatorCompactionPlugin } from '../../scripts/lib/extension-validator-compaction';
import { extensionValidationLocalesPlugin } from '../../scripts/lib/extension-validation-locales';

export default defineConfig({
  // Shared workspace modules use explicit imports. WXT's lexical auto-importer can
  // mistake a local Storage parameter for its extension-only `storage` helper.
  imports: false,
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    define: {
      __ONE_VEGETABLE_EXTENSION__: 'true',
      // The app already uses composition mode; retain both locales and the message compiler.
      __VUE_I18N_LEGACY_API__: 'false',
      'import.meta.env.VITE_APP_RUNTIME': JSON.stringify('extension')
    },
    plugins: [tailwindcss(), extensionValidatorCompactionPlugin(), extensionValidationLocalesPlugin()],
    // Chrome 102 supports ES2020; keep safe modern syntax instead of ES5-style minifier output.
    build: {
      minify: 'terser',
      terserOptions: { maxWorkers: 2, ecma: 2020, compress: { passes: 3 }, format: { comments: false } }
    }
  }),
  hooks: {
    'config:resolved'(wxt) {
      // WXT 0.21.4 still installs unimport for #imports when disabled.
      // Also disable source injection using unimport's own option.
      Object.assign(wxt.config.imports, { autoImport: false });
    },
    'vite:build:extendConfig'(entrypoints, config) {
      // Only the ESM group can split modules. Content scripts stay single-file.
      if (!entrypoints.some((entry) => entry.type === 'background')) return;
      config.build ??= {};
      config.build.rollupOptions ??= {};
      const output = config.build.rollupOptions.output;
      if (Array.isArray(output)) throw new Error('Expected one MV3 ESM output');
      config.build.rollupOptions.output = {
        ...output,
        codeSplitting: {
          groups: [
            {
              name: 'release-notes',
              test: /core[\\/]src[\\/](?:generated[\\/])?release-notes\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              name: 'alibaba-authorizations',
              test: /[\\/]apps[\\/]extension[\\/]lib[\\/](?:alibaba-authorizations|authorization-refresh)\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              name: 'credential-acquisition',
              test: /[\\/]apps[\\/]extension[\\/]lib[\\/]alibaba-credential-acquisition\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              // Pure input helpers live separately, so readers never import runtime registration.
              name: 'iop-authorization',
              test: /[\\/]apps[\\/]extension[\\/]lib[\\/]iop-authorization(?:-runtime)?\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              name: 'authorization-services',
              test: /[\\/]apps[\\/]extension[\\/]lib[\\/](?:iop-application-reader|top-application-reader|top-authorization-token-client|authorization-protection|credential-vault-session)\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              name: 'product-mutation-lifecycle',
              test: /[\\/]apps[\\/]extension[\\/]lib[\\/]product-display-mutation-lifecycle\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              // Durable maintenance is shared by MV3 and its lazy workspace, not background registration.
              name: 'product-maintenance-model',
              test: /core[\\\\/]src[\\\\/]product-maintenance-(?:api|service)\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              // Never merge background registration with the model consumed by the Options page.
              name: 'product-maintenance-backend',
              test: /(?:apps[\\\\/]extension[\\\\/]lib[\\\\/]product-maintenance-(?:service|repository)|core[\\\\/]src[\\\\/]product-maintenance-(?:platform|runtime-policy))\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              name: 'product-workbench-identifiers',
              test: /core[\\\\/]src[\\\\/]product-(?:workbench-methods|reference-methods)\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              name: 'bff-control',
              test: /core[\\\\/]src[\\\\/]control-client\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              name: 'product-maintenance-control',
              test: /core[\\\\/]src[\\\\/]product-maintenance-control\.ts$/u,
              includeDependenciesRecursively: false
            },
            {
              // Retain validator grouping; Options also uses the shared protocol selector.
              name(id) {
                const path = id.replaceAll('\\', '/');
                if (path.endsWith('/packages/core/src/validation-equal.ts')) return 'validation-equal';
                return /\/generated\/(validators-(?:product|product-workbench|product-maintenance(?:-parameters)?|rfq|trade|logistics|insights|photo|platform|free-api|video-upload))\.ts$/.exec(
                  path
                )?.[1];
              }
            }
          ]
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
    externally_connectable: { ids: [], matches: ['https://one-vegetable-auth.pages.dev/*'] },
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
