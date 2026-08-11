import { createApp } from 'vue';
import { browser } from 'wxt/browser';

import App from './App.vue';
import '@one-vegetable/ui/styles.css';

createApp(App, { openDashboard: () => browser.runtime.openOptionsPage() }).mount('#app');
