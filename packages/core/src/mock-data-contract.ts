import type { OperationId, OperationMap, PhotoGroup } from './types';

type OperationResponses<K extends OperationId> = {
  [P in K]: OperationMap[P]['response'];
};

export interface ProductMockData {
  responses: OperationResponses<
    | 'listProducts'
    | 'getProduct'
    | 'getProductSchema'
    | 'publishProduct'
    | 'saveProductDraft'
    | 'updateProduct'
    | 'listProductCategories'
    | 'mapProductCategory'
    | 'getProductLevelSchema'
    | 'getProductDraft'
    | 'listProductGroups'
    | 'createProductGroup'
    | 'getProductScore'
  >;
}

export interface PhotoMockData {
  photoGroups: PhotoGroup[];
  responses: OperationResponses<
    'listPhotoGroups' | 'operatePhotoGroup' | 'listPhotos' | 'uploadPhoto' | 'transferPhotoFromUrl'
  >;
}
