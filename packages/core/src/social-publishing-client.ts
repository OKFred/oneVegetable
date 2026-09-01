import type {
  SocialDestination,
  SocialPostPermalink,
  SocialPostPrepareRequest,
  SocialPublishJob
} from './social-meta';

export interface SocialPublishingClient {
  listSocialDestinations(): Promise<SocialDestination[]>;
  prepareSocialPost(input: Omit<SocialPostPrepareRequest, 'requestId'>): Promise<SocialPublishJob>;
  publishSocialPost(jobId: string): Promise<SocialPublishJob>;
  advanceSocialPost(jobId: string): Promise<SocialPublishJob>;
  getSocialPost(jobId: string): Promise<SocialPublishJob>;
  getSocialPostPermalink(jobId: string): Promise<SocialPostPermalink>;
  listSocialPosts(limit?: number): Promise<SocialPublishJob[]>;
  cancelSocialPost(jobId: string): Promise<SocialPublishJob>;
}
