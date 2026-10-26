import { describe, expect, it } from 'vitest';
import { mediaErrorGuidance } from '../src/lib/media-error-guidance';

describe('media error next actions', () => {
  it.each(['ALIBABA_IOP_PHOTO_SCOPE_MISMATCH', 'GALLERY_READBACK_UNVERIFIED'])(
    'offers bounded settings and official entry for %s',
    (code) => {
      expect(mediaErrorGuidance(code)).toMatchObject({
        configureTop: true,
        officialUrl: 'https://i.alibaba.com/'
      });
    }
  );
  it('does not confuse choosing a group with adding authorization', () => {
    expect(mediaErrorGuidance('ALIBABA_IOP_PHOTO_GROUP_REQUIRED')?.configureTop).toBe(false);
  });
  it('only offers video-query advice for explicitly identified video reads', () => {
    expect(mediaErrorGuidance('ALIBABA_IOP_BUSINESS_REJECTED')).toBeNull();
    expect(mediaErrorGuidance('ALIBABA_IOP_BUSINESS_REJECTED', 'photos')).toBeNull();
    expect(mediaErrorGuidance('ALIBABA_IOP_BUSINESS_REJECTED', 'videos')).toMatchObject({
      message: 'common.error.mediaGuidance.videoRejected',
      officialUrl: 'https://us-productposting.alibaba.com/product/videobank/home.htm'
    });
  });
  it.each(['ALIBABA_IOP_METHOD_UNSUPPORTED', 'ALIBABA_IOP_PARAMETER_UNSUPPORTED'])(
    'requires explicit media context for %s',
    (code) => {
      expect(mediaErrorGuidance(code)).toBeNull();
      expect(mediaErrorGuidance(code, 'photos')?.configureTop).toBe(true);
    }
  );
  it.each([null, undefined, '', 'PERMISSION_DENIED', '27', 'SESSION_EXPIRED', 'untrusted-code'])(
    'does not misclassify %s',
    (code) => {
      expect(mediaErrorGuidance(code, 'videos')).toBeNull();
    }
  );
});
