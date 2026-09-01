import { createApp } from 'vue';
import { browser } from 'wxt/browser';

import { uiI18n } from '@one-vegetable/ui';

import App from './App.vue';
import '@one-vegetable/ui/styles.css';

const app = createApp(App, { openDashboard: () => browser.runtime.openOptionsPage() });
app.use(uiI18n);
app.mount('#app');
