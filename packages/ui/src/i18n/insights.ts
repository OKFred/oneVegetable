import { uiI18n } from './index';
import { insights as zh } from './messages/zh-CN/insights';
import { insights as en } from './messages/en-US/insights';

uiI18n.global.mergeLocaleMessage('zh-CN', { insights: zh });
uiI18n.global.mergeLocaleMessage('en-US', { insights: en });
