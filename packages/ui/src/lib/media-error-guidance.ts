export type MediaErrorFeature = 'photos' | 'videos';

export interface MediaErrorGuidance {
  message: string;
  configureTop: boolean;
  officialUrl: string;
}

/** Presentation only: never grants permission, selects credentials or retries a request. */
export function mediaErrorGuidance(
  code: string | null | undefined,
  feature?: MediaErrorFeature
): MediaErrorGuidance | null {
  const officialUrl =
    feature === 'videos'
      ? 'https://us-productposting.alibaba.com/product/videobank/home.htm'
      : 'https://i.alibaba.com/';
  const result = (message: string, configureTop = true): MediaErrorGuidance => ({
    message: 'common.error.mediaGuidance.' + message,
    configureTop,
    officialUrl
  });
  if (code === 'GALLERY_READBACK_UNVERIFIED') return result('importReadback');
  if (code === 'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH') return result('photoScope');
  if (code === 'ALIBABA_IOP_PHOTO_GROUP_REQUIRED') return result('chooseGroup', false);
  if (code === 'ALIBABA_IOP_BUSINESS_REJECTED' && feature === 'videos') return result('videoRejected');
  if (feature && ['ALIBABA_IOP_METHOD_UNSUPPORTED', 'ALIBABA_IOP_PARAMETER_UNSUPPORTED'].includes(code ?? ''))
    return result('unsupported');
  return null;
}
