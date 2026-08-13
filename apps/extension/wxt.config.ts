import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'oneVeg/一根青菜',
    version: '2.0.0',
    description: 'Alibaba.com international operations workspace',
    default_locale: 'zh_CN',
    permissions: ['storage'],
    host_permissions: ['https://eco.taobao.com/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: '一根青菜',
      default_icon: { 16: 'icon.png', 32: 'icon.png', 48: 'icon.png', 128: 'icon.png' }
    },
    icons: { 16: 'icon.png', 32: 'icon.png', 48: 'icon.png', 128: 'icon.png' },
    homepage_url: 'https://activity.alibaba.com/pc/developer.html',
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'"
    }
  }
});
