import { uiI18n } from './index';
import { shippingServices as zh } from './messages/zh-CN/shipping-services';
import { shippingServices as en } from './messages/en-US/shipping-services';

uiI18n.global.mergeLocaleMessage('zh-CN', { shippingServices: zh });
uiI18n.global.mergeLocaleMessage('en-US', { shippingServices: en });
