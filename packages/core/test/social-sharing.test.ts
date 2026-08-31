import { describe, expect, it } from 'vitest';

import {
  getSocialPlatformDefinition,
  SOCIAL_PLATFORM_DEFINITIONS,
  SOCIAL_SHARE_MAX_TOTAL_BYTES,
  validateSocialShareSelection
} from '../src/social-sharing';

describe('social sharing capability definitions', () => {
  it('documents every supported destination without implying a configured account', () => {
    expect(SOCIAL_PLATFORM_DEFINITIONS.map((item) => item.id)).toEqual([
      'facebook',
      'instagram',
      'x',
      'tiktok'
    ]);
    expect(getSocialPlatformDefinition('instagram').accountRequirement).toContain('专业账号');
    expect(getSocialPlatformDefinition('tiktok').mediaRequirement).toContain('已验证域名');
  });

  it('guards empty, oversized and over-count selections', () => {
    expect(validateSocialShareSelection(0, 0)).toContain('请至少选择 1 张图片');
    expect(validateSocialShareSelection(21, 1024)).toContain('单次最多准备 20 张图片');
    expect(validateSocialShareSelection(1, SOCIAL_SHARE_MAX_TOTAL_BYTES + 1)).toContain(
      '单次分享素材不能超过 50 MiB'
    );
    expect(validateSocialShareSelection(4, 4 * 1024 * 1024)).toEqual([]);
  });
});
