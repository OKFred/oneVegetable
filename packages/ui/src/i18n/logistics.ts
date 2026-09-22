import { uiI18n } from './index';
import { logistics as zh } from './messages/zh-CN/logistics';
import { logistics as en } from './messages/en-US/logistics';

// Only the lazy logistics workspace needs this namespace. Both locales remain bundled.
uiI18n.global.mergeLocaleMessage('zh-CN', { logistics: zh });
uiI18n.global.mergeLocaleMessage('en-US', { logistics: en });
