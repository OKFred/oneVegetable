export const DEFAULT_LOCAL_REAL_MUTATION_FLAGS = [
  'operation:publishProduct',
  'operation:saveProductDraft',
  'operation:updateProduct',
  'operation:updateProductDisplay',
  'operation:operatePhotoGroup',
  'operation:uploadPhoto',
  'operation:transferPhotoFromUrl'
] as const;

export function resolveLocalRealMutationFlags(configured: string | undefined): string {
  return configured ?? DEFAULT_LOCAL_REAL_MUTATION_FLAGS.join(',');
}
