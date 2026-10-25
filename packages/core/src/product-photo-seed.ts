import { isPhotoBankUrl } from './product-description-url';
import {
  isProductSchemaFieldDisabled,
  isProductSchemaFieldReadOnly,
  isProductSchemaFixedSlotCollection,
  isProductSchemaImageField,
  markProductSchemaFieldTouched,
  type ProductSchemaField,
  type ProductSchemaModel,
  type ProductSchemaValue
} from './product-schema';
import type { Photo } from './types';

export type ProductPhotoSeedReasonCode =
  'invalid-photo' | 'unsupported-field' | 'field-not-empty' | 'capacity-exceeded';

const ERROR_MESSAGES: Record<ProductPhotoSeedReasonCode, string> = {
  'invalid-photo': 'The photo selection is empty, invalid or contains conflicting file IDs.',
  'unsupported-field': 'Exactly one supported writable main-image root field is required.',
  'field-not-empty': 'The main-image field already contains data.',
  'capacity-exceeded': 'The photo selection exceeds the main-image field capacity.'
};

export class ProductPhotoSeedError extends Error {
  readonly reasonCode: ProductPhotoSeedReasonCode;
  readonly capacity?: number;

  constructor(reasonCode: ProductPhotoSeedReasonCode, capacity?: number) {
    super(ERROR_MESSAGES[reasonCode]);
    this.name = 'ProductPhotoSeedError';
    this.reasonCode = reasonCode;
    if (capacity !== undefined) this.capacity = capacity;
  }
}

/** Validate a complete selection and detach its flat Photo records without normalizing IDs or URLs. */
export function snapshotProductPhotoSeed(photos: readonly Photo[]): Photo[] {
  if (!Array.isArray(photos) || photos.length === 0) {
    throw new ProductPhotoSeedError('invalid-photo');
  }
  const snapshots: Photo[] = [];
  const identities = new Map<string, string>();
  // for...of also visits sparse-array holes, which must not silently become missing images.
  for (const photo of photos) {
    if (!isSeedPhoto(photo)) throw new ProductPhotoSeedError('invalid-photo');
    const snapshot = { ...photo };
    const identity = JSON.stringify(photoValue(snapshot));
    const previous = identities.get(snapshot.id);
    if (previous !== undefined && previous !== identity) {
      throw new ProductPhotoSeedError('invalid-photo');
    }
    identities.set(snapshot.id, identity);
    snapshots.push(snapshot);
  }
  return snapshots;
}

/** Seed only an empty, unambiguous main-image root; never modify the source model or XML. */
export function applyProductPhotoSeed(
  model: ProductSchemaModel,
  photos: readonly Photo[]
): ProductSchemaModel {
  const selection = snapshotProductPhotoSeed(photos);
  const candidates = model.fields.filter(isMainImageRoot);
  const field = candidates[0];
  if (
    candidates.length !== 1 ||
    !field ||
    (field.type !== 'input' && field.type !== 'multiInput' && field.type !== 'complex') ||
    isProductSchemaFieldReadOnly(field) ||
    isProductSchemaFieldDisabled(field)
  ) {
    throw new ProductPhotoSeedError('unsupported-field');
  }
  if (field.values.some(hasImageData)) {
    throw new ProductPhotoSeedError('field-not-empty');
  }
  const fixedSlots = field.type === 'complex' ? fixedImageSlots(field) : null;
  const capacity = fixedSlots?.length ?? imageCapacity(field);
  if (selection.length > capacity) {
    throw new ProductPhotoSeedError('capacity-exceeded', capacity);
  }

  // Clone plain records explicitly so reactive proxies work without a UI-specific unwrap.
  const result = {
    ...model,
    fields: model.fields.map(cloneField),
    warnings: [...model.warnings],
    touchedFieldKeys: [...model.touchedFieldKeys]
  };
  const target = result.fields[model.fields.indexOf(field)];
  if (!target) throw new ProductPhotoSeedError('unsupported-field');
  const touched = target.type === 'complex' ? seedFixedImageSlots(target, selection) : [];
  if (target.type !== 'complex') target.values = selection.map(photoValue);
  let seeded = markProductSchemaFieldTouched(result, target.key);
  for (const key of touched) seeded = markProductSchemaFieldTouched(seeded, key);
  return seeded;
}

function fixedImageSlots(field: ProductSchemaField): ProductSchemaField[] {
  const maximum = imageCapacity(field);
  // The existing fixed-slot helper describes complex-valued slots (for example ladder prices),
  // not the flat input slots exposed by fresh main-image schemas.
  if (
    isProductSchemaFixedSlotCollection(field) ||
    !field.rules.some((rule) => rule.name === 'maxInputNumRule') ||
    field.children.length !== maximum ||
    field.instances.length > 1
  ) {
    throw new ProductPhotoSeedError('unsupported-field');
  }
  const matchesTemplate = (slots: ProductSchemaField[]): boolean =>
    slots.length === maximum &&
    slots.every(
      (slot, index) =>
        slot.id === field.children[index]?.id &&
        slot.id === `${field.id}_${index}` &&
        slot.type === 'input' &&
        isProductSchemaImageField(slot) &&
        slot.children.length === 0 &&
        slot.instances.length === 0 &&
        slot.values.length <= 1
    );
  if (!matchesTemplate(field.children)) throw new ProductPhotoSeedError('unsupported-field');
  const slots = field.instances[0]?.fields ?? field.children;
  if (!matchesTemplate(slots)) throw new ProductPhotoSeedError('unsupported-field');
  if (
    field.values.some(hasImageData) ||
    field.children.some((slot) => slot.values.some(hasImageData)) ||
    slots.some((slot) => slot.values.some(hasImageData))
  ) {
    throw new ProductPhotoSeedError('field-not-empty');
  }
  return slots;
}

function seedFixedImageSlots(field: ProductSchemaField, selection: readonly Photo[]): string[] {
  const templateSlots = fixedImageSlots(field);
  if (selection.length > templateSlots.length) {
    throw new ProductPhotoSeedError('capacity-exceeded', templateSlots.length);
  }
  // Do not skip locked positions and silently change which photo is the cover.
  for (let index = 0; index < selection.length; index += 1) {
    const slot = templateSlots[index];
    const template = field.children[index];
    if (!slot || !template || !isWritable(slot) || !isWritable(template)) {
      throw new ProductPhotoSeedError('unsupported-field');
    }
    imageCapacity(slot);
    imageCapacity(template);
  }
  const existing = field.instances[0];
  const instance = existing ?? {
    key: `${field.key}:instance:new:0`,
    sourcePath: null,
    sourceIndex: null,
    fields: field.children.map(cloneField)
  };
  const touched: string[] = [];
  selection.forEach((photo, index) => {
    const slot = instance.fields[index];
    if (!slot) throw new ProductPhotoSeedError('unsupported-field');
    const value = photoValue(photo);
    slot.values = [
      {
        ...value,
        attributes: { ...(slot.values[0]?.attributes ?? {}), ...value.attributes }
      }
    ];
    touched.push(slot.key);
  });
  field.instances = [instance];
  return touched;
}

function isWritable(field: ProductSchemaField): boolean {
  return !isProductSchemaFieldReadOnly(field) && !isProductSchemaFieldDisabled(field);
}

function cloneField(field: ProductSchemaField): ProductSchemaField {
  return {
    ...field,
    attributes: { ...field.attributes },
    values: field.values.map((value) => ({
      ...value,
      attributes: { ...value.attributes },
      metadata: { ...value.metadata }
    })),
    options: field.options.map((option) => ({ ...option, attributes: { ...option.attributes } })),
    rules: field.rules.map((rule) => ({
      ...rule,
      attributes: { ...rule.attributes },
      dependGroups: rule.dependGroups.map((group) => ({
        ...group,
        expressions: group.expressions.map((expression) => ({ ...expression }))
      }))
    })),
    children: field.children.map(cloneField),
    instances: field.instances.map((instance) => ({
      ...instance,
      fields: instance.fields.map(cloneField)
    }))
  };
}

function isMainImageRoot(field: ProductSchemaField): boolean {
  const id = field.id.replaceAll(/[^a-z]/giu, '').toLowerCase();
  return (id === 'scimages' || id === 'mainimages') && isProductSchemaImageField({ ...field, id });
}

function imageCapacity(field: ProductSchemaField): number {
  const rules = field.rules.filter((rule) => rule.name === 'maxInputNumRule');
  if (rules.length === 0) return field.type === 'input' ? 1 : 6;
  const rule = rules[0];
  if (!rule || rules.length !== 1 || rule.dependGroups.length > 0 || !/^\d+$/u.test(rule.value.trim())) {
    throw new ProductPhotoSeedError('unsupported-field');
  }
  const capacity = Number(rule.value);
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new ProductPhotoSeedError('unsupported-field');
  }
  return field.type === 'input' ? 1 : capacity;
}

function hasImageData(value: ProductSchemaValue): boolean {
  return (
    value.text.trim().length > 0 ||
    Object.entries(value.attributes).some(
      ([key, text]) =>
        text.trim().length > 0 && !(key === 'img' && /^(?:true|false|0|1)$/iu.test(text.trim()))
    ) ||
    Object.values(value.metadata).some((text: unknown) => typeof text === 'string' && text.trim().length > 0)
  );
}

function photoValue(photo: Photo): ProductSchemaValue {
  return {
    text: photo.url,
    attributes: { fileId: photo.id },
    metadata: {
      fileName: photo.name,
      groupId: photo.groupId,
      ...(photo.width === null ? {} : { width: String(photo.width) }),
      ...(photo.height === null ? {} : { height: String(photo.height) }),
      fileSize: String(photo.fileSize),
      referenceCount: String(photo.referenceCount),
      modifiedAt: photo.modifiedAt
    }
  };
}

function isSeedPhoto(value: unknown): value is Photo {
  if (typeof value !== 'object' || value === null) return false;
  const photo = value as Record<string, unknown>;
  return (
    typeof photo.id === 'string' &&
    photo.id.length > 0 &&
    !/\s/u.test(photo.id) &&
    !hasControlCharacters(photo.id) &&
    isSeedUrl(photo.url) &&
    typeof photo.name === 'string' &&
    typeof photo.groupId === 'string' &&
    isDimension(photo.width) &&
    isDimension(photo.height) &&
    isNonNegativeInteger(photo.fileSize) &&
    isNonNegativeInteger(photo.referenceCount) &&
    typeof photo.modifiedAt === 'string' &&
    (photo.previewUrl === undefined || typeof photo.previewUrl === 'string') &&
    (photo.originalName === undefined ||
      photo.originalName === null ||
      typeof photo.originalName === 'string') &&
    (photo.ownerName === undefined || photo.ownerName === null || typeof photo.ownerName === 'string')
  );
}

function isSeedUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^https:\/\//iu.test(value) ||
    /[\s\\]/u.test(value) ||
    hasControlCharacters(value) ||
    !isPhotoBankUrl(value)
  ) {
    return false;
  }
  const url = new URL(value);
  const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/u)[0] ?? '';
  return !authority.includes('@') && !url.username && !url.password && !url.port;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isDimension(value: unknown): boolean {
  return value === null || (isNonNegativeInteger(value) && value > 0);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
