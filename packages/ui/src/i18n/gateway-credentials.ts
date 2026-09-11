import { uiI18n, useUiI18n } from './index';
import { gatewayCredentials as zh } from './messages/zh-CN/gatewayCredentials';
import { gatewayCredentials as en } from './messages/en-US/gatewayCredentials';
uiI18n.global.mergeLocaleMessage('zh-CN', { gatewayCredentials: zh });
uiI18n.global.mergeLocaleMessage('en-US', { gatewayCredentials: en });
export function useGatewayCredentialsI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh, values?: Record<string, unknown>) => t(`gatewayCredentials.${key}`, values);
}
