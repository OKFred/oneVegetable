import { uiI18n, useUiI18n } from './index';
import { video as zh } from './messages/zh-CN/video';
import { video as en } from './messages/en-US/video';
uiI18n.global.mergeLocaleMessage('zh-CN', {
  video: zh,
  errors: {
    codes: { VIDEO_RESPONSE_INVALID: zh.responseInvalid, VIDEO_PROVIDER_REJECTED: zh.providerRejected }
  }
});
uiI18n.global.mergeLocaleMessage('en-US', {
  video: en,
  errors: {
    codes: { VIDEO_RESPONSE_INVALID: en.responseInvalid, VIDEO_PROVIDER_REJECTED: en.providerRejected }
  }
});
export function useVideoI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh, values?: Record<string, unknown>) => t(`video.${key}`, values);
}
