import type { SocialDestination, SocialPostPrepareRequest, SocialPublishJob } from './social-meta';

export interface SocialPublishingClient {
  listSocialDestinations(): Promise<SocialDestination[]>;
  prepareSocialPost(input: Omit<SocialPostPrepareRequest, 'requestId'>): Promise<SocialPublishJob>;
  publishSocialPost(jobId: string): Promise<SocialPublishJob>;
  advanceSocialPost(jobId: string): Promise<SocialPublishJob>;
  getSocialPost(jobId: string): Promise<SocialPublishJob>;
  listSocialPosts(limit?: number): Promise<SocialPublishJob[]>;
  cancelSocialPost(jobId: string): Promise<SocialPublishJob>;
}
