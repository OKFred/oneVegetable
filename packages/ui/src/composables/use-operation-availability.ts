import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';

import type { OperationAvailability, OperationId } from '@one-vegetable/core';

import { useServices } from '../lib/services';

export function useOperationAvailability(operations: readonly OperationId[]) {
  const { operationAvailability } = useServices();
  const requested = [...new Set(operations)];
  const availability = useQuery({
    queryKey: ['operation-availability', ...requested],
    queryFn: () =>
      operationAvailability?.get(requested) ??
      Promise.resolve({
        items: requested.map((operation) => ({
          operation,
          allowed: false,
          reasonCode: 'OPERATION_AVAILABILITY_UNAVAILABLE'
        }))
      }),
    networkMode: 'always',
    staleTime: 10_000
  });
  const byOperation = computed(
    () => new Map(availability.data.value?.items.map((item) => [item.operation, item] as const) ?? [])
  );

  function decision(operation: OperationId): OperationAvailability {
    return (
      byOperation.value.get(operation) ?? {
        operation,
        allowed: false,
        reasonCode: availability.isPending.value
          ? 'OPERATION_AVAILABILITY_PENDING'
          : 'OPERATION_AVAILABILITY_UNAVAILABLE'
      }
    );
  }

  return {
    query: availability,
    isPending: availability.isPending,
    decision,
    isAllowed: (operation: OperationId) => decision(operation).allowed,
    reasonCode: (operation: OperationId) => decision(operation).reasonCode
  };
}

export function operationAvailabilityMessage(reasonCode: string | null, fallback: string): string {
  if (reasonCode === 'OPERATION_AVAILABILITY_PENDING') return '正在读取当前账号的操作权限…';
  return reasonCode ? `${fallback}（${reasonCode}）` : fallback;
}
