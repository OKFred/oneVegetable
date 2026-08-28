export function shouldCleanupPublishedProduct(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  return environment.ONE_VEGETABLE_REAL_PRODUCT_PUBLISH_CLEANUP === '1';
}
