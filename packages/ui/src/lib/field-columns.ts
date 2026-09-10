import { h } from 'vue';
import type { RowData } from '@tanstack/vue-table';
import type { DataColumn } from './table';
import { formatDateTime } from './date-time';

export function fieldColumn<T extends RowData>(
  id: string,
  label: string,
  read: (row: T) => unknown,
  booleanLabels: [string, string]
): DataColumn<T> {
  return {
    id,
    header: label,
    cell: ({ row }) => {
      const value = read(row.original);
      const text =
        value == null || value === ''
          ? '—'
          : typeof value === 'boolean'
            ? booleanLabels[value ? 0 : 1]
            : Array.isArray(value)
              ? value.join(', ') || '—'
              : id.endsWith('At') && (typeof value === 'string' || typeof value === 'number')
                ? formatDateTime(value)
                : typeof value === 'string' || typeof value === 'number'
                  ? String(value)
                  : '—';
      return h(
        'span',
        {
          class: 'block max-w-64 truncate whitespace-nowrap',
          title: text,
          ...(['ownerName', 'trackingNumber'].includes(id) ? { 'data-feedback-redact': '' } : {})
        },
        text
      );
    }
  };
}

export const productExtraFields = [
  'keywords',
  'categoryId',
  'groupId',
  'createdAt',
  'ownerName',
  'productType',
  'language',
  'model',
  'isRts',
  'isSpecific',
  'smartEdit',
  'imageCount',
  'platformStatus',
  'encryptedId'
] as const;
export const photoExtraFields = ['groupId', 'originalName', 'ownerName', 'url'] as const;
