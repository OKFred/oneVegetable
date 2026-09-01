export const SOCIAL_SHARE_MAX_PHOTOS = 20;
export const SOCIAL_SHARE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export type SocialPlatformId = 'facebook' | 'instagram' | 'x' | 'tiktok';

export interface SocialPlatformDefinition {
  id: SocialPlatformId;
  label: string;
  destination: string;
  accountRequirement: string;
  apiRequirement: string;
  mediaRequirement: string;
  documentationUrl: string;
}

export const SOCIAL_PLATFORM_DEFINITIONS = [
  {
    id: 'facebook',
    label: 'Facebook',
    destination: 'Facebook Page',
    accountRequirement: '需要有管理权限的 Facebook Page；不支持替个人主页自动发帖。',
    apiRequirement: '需要 Meta 应用、用户授权、Page access token 与 pages_manage_posts 权限。',
    mediaRequirement: '图片由服务端上传到 Page，发布前必须由用户明确确认。',
    documentationUrl: 'https://developers.facebook.com/docs/pages-api/posts/'
  },
  {
    id: 'instagram',
    label: 'Instagram',
    destination: 'Instagram 专业账号',
    accountRequirement: '需要 Business 或 Creator 专业账号；普通个人账号不支持内容发布 API。',
    apiRequirement: '需要 Meta 应用、用户 OAuth 与 instagram_business_content_publish 权限。',
    mediaRequirement: '平台会从公共 HTTPS 地址拉取图片，素材必须在发布期间稳定可访问。',
    documentationUrl: 'https://developers.facebook.com/docs/instagram-platform/content-publishing/'
  },
  {
    id: 'x',
    label: 'X',
    destination: 'X 账号',
    accountRequirement: '需要 X 开发者项目和由发帖账号完成的用户 OAuth 授权。',
    apiRequirement: '需要可写用户令牌；媒体先上传，再使用 media ID 创建 Post，接口按量计费。',
    mediaRequirement: '单条 Post 最多附带 4 张图片。',
    documentationUrl: 'https://docs.x.com/x-api/posts/manage-tweets/quickstart'
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    destination: 'TikTok 创作者账号',
    accountRequirement: '需要 TikTok 开发者应用，并由目标创作者账号完成 OAuth 授权。',
    apiRequirement: '直发需要审核通过的 video.publish；上传草稿使用 video.upload。',
    mediaRequirement: '照片仅支持从已验证域名的公共 URL 拉取，不能直接使用任意第三方 CDN URL。',
    documentationUrl: 'https://developers.tiktok.com/docs/en/content-posting-api-get-started'
  }
] as const satisfies readonly SocialPlatformDefinition[];

export function getSocialPlatformDefinition(id: SocialPlatformId): SocialPlatformDefinition {
  const definition = SOCIAL_PLATFORM_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`不支持的社交平台：${id}`);
  return definition;
}

export function validateSocialShareSelection(
  photoCount: number,
  totalBytes: number,
  locale: UiLocale = 'zh-CN'
): string[] {
  const messages =
    locale === 'en-US'
      ? {
          minimum: 'Select at least one image',
          maximum: `Prepare at most ${SOCIAL_SHARE_MAX_PHOTOS} images at a time`,
          invalidSize: 'The total image size is invalid',
          totalSize: 'Shared assets cannot exceed 50 MiB per operation'
        }
      : {
          minimum: '请至少选择 1 张图片',
          maximum: `单次最多准备 ${SOCIAL_SHARE_MAX_PHOTOS} 张图片`,
          invalidSize: '图片大小统计无效',
          totalSize: '单次分享素材不能超过 50 MiB'
        };
  const issues: string[] = [];
  if (!Number.isInteger(photoCount) || photoCount < 1) issues.push(messages.minimum);
  if (photoCount > SOCIAL_SHARE_MAX_PHOTOS) {
    issues.push(messages.maximum);
  }
  if (!Number.isFinite(totalBytes) || totalBytes < 0) issues.push(messages.invalidSize);
  if (totalBytes > SOCIAL_SHARE_MAX_TOTAL_BYTES) issues.push(messages.totalSize);
  return issues;
}
import type { UiLocale } from './preferences';
