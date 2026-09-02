<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { ExternalLink, FileText, Paperclip, Save, Search, Send, ShieldAlert, Sparkles } from '@lucide/vue';
import { toast } from 'vue-sonner';

import {
  normalizeGatewayError,
  type GatewayError,
  type RfqAttachmentUploadRequest,
  type RfqQuotationRequest,
  type RfqSummary
} from '@one-vegetable/core';

import ActionTooltip from '../components/ActionTooltip.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import Sheet from '../components/ui/Sheet.vue';
import { useUiI18n } from '../i18n';
import {
  operationAvailabilityMessage,
  useOperationAvailability
} from '../composables/use-operation-availability';
import { formatDate } from '../lib/date-time';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

type RfqSource = 'search' | 'recommend';

interface QuotationDraft {
  message: string;
  paymentTerms: string;
  expiresAt: string;
  itemName: string;
  unitPrice: string;
  currency: string;
  quantity: string;
  quantityUnit: string;
  shippingTerms: string;
  port: string;
  remark: string;
  attachmentFilesString: string;
}

const { gateway, mode } = useServices();
const { t } = useUiI18n();
const source = ref<RfqSource>('search');
const keywords = ref('');
const country = ref('');
const unquotedOnly = ref(true);
const appliedFilters = ref({ keywords: '', country: '', unquotedOnly: true });
const rfqPage = ref(1);
const rfqPageSize = ref(20);
const selectedRfqId = ref('');
const rfqSheetOpen = ref(false);
const draftSaved = ref(false);
const attachmentError = ref('');
const attachmentName = ref('');

function emptyDraft(rfq?: RfqSummary): QuotationDraft {
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    message: '',
    paymentTerms: 'T/T',
    expiresAt: expiry.toISOString().slice(0, 10),
    itemName: rfq?.subject ?? '',
    unitPrice: '',
    currency: 'USD',
    quantity: rfq?.quantity === null || rfq?.quantity === undefined ? '' : String(rfq.quantity),
    quantityUnit: rfq?.quantityUnit ?? 'Pieces',
    shippingTerms: 'FOB',
    port: '',
    remark: '',
    attachmentFilesString: ''
  };
}

const draft = ref<QuotationDraft>(emptyDraft());
const equity = useQuery({
  queryKey: ['rfq-equity'],
  queryFn: () => gateway.request('getRfqEquity', undefined),
  staleTime: 5 * 60 * 1000
});
const equityPermissionDenied = computed(() => isRfqPermissionDenied(equity.error.value));
const rfqAccessReady = computed(() => equity.isSuccess.value);
const listKey = computed(() => [
  'rfqs',
  source.value,
  appliedFilters.value.keywords,
  appliedFilters.value.country,
  appliedFilters.value.unquotedOnly,
  rfqPage.value,
  rfqPageSize.value
]);
const rfqs = useQuery({
  queryKey: listKey,
  enabled: computed(() => rfqAccessReady.value && !equityPermissionDenied.value),
  queryFn: () =>
    source.value === 'recommend'
      ? gateway.request('listRecommendedRfqs', { page: rfqPage.value, pageSize: rfqPageSize.value })
      : gateway.request('listRfqs', {
          page: rfqPage.value,
          pageSize: rfqPageSize.value,
          ...(appliedFilters.value.keywords ? { keywords: appliedFilters.value.keywords } : {}),
          ...(appliedFilters.value.country ? { country: appliedFilters.value.country } : {}),
          unquotedOnly: appliedFilters.value.unquotedOnly
        })
});
const rfqPackageDenied = computed(
  () => equityPermissionDenied.value || isRfqPermissionDenied(rfqs.error.value)
);
const rfqAccessError = computed<GatewayError | null>(() => {
  const error = rfqPackageDenied.value
    ? [equity.error.value, rfqs.error.value].find(isRfqPermissionDenied)
    : equity.error.value;
  return error ? normalizeGatewayError(error) : null;
});
const rfqWorkspaceReady = computed(() => rfqAccessReady.value && !rfqPackageDenied.value);
const rfqListLoading = computed(
  () => !rfqPackageDenied.value && (equity.isPending.value || rfqs.isPending.value)
);
const visibleRfqIds = computed(() => (rfqs.data.value?.items ?? []).map((rfq) => rfq.id));
const readStatus = useQuery({
  queryKey: computed(() => ['rfq-read-status', ...visibleRfqIds.value]),
  enabled: computed(() => visibleRfqIds.value.length > 0),
  queryFn: () => gateway.request('getRfqReadStatus', { rfqIds: visibleRfqIds.value.slice(0, 20) })
});
const detail = useQuery({
  queryKey: computed(() => ['rfq-detail', selectedRfqId.value]),
  enabled: computed(() => selectedRfqId.value !== ''),
  queryFn: () => gateway.request('getRfq', { rfqId: selectedRfqId.value })
});
const selectedSummary = computed(() =>
  (rfqs.data.value?.items ?? []).find((rfq) => rfq.id === selectedRfqId.value)
);
const rfqMutations = useOperationAvailability(['uploadRfqAttachment', 'submitRfqQuotation']);
const attachmentMutationBlocked = computed(() => !rfqMutations.isAllowed('uploadRfqAttachment'));
const quotationMutationBlocked = computed(() => !rfqMutations.isAllowed('submitRfqQuotation'));
const realMutationBlocked = computed(() => attachmentMutationBlocked.value || quotationMutationBlocked.value);
const mutationAvailabilityReason = computed(() => {
  const reasonCodes = [
    rfqMutations.reasonCode('uploadRfqAttachment'),
    rfqMutations.reasonCode('submitRfqQuotation')
  ].filter((reasonCode, index, values) => reasonCode && values.indexOf(reasonCode) === index);
  return operationAvailabilityMessage(reasonCodes.join(', ') || null, t('rfqs.mutation.unavailable'));
});
const missingQuotationFields = computed(() => {
  const missing: string[] = [];
  if (!selectedRfqId.value) missing.push(t('rfqs.fields.rfq'));
  if (!draft.value.message.trim()) missing.push(t('rfqs.fields.message'));
  if (!draft.value.itemName.trim()) missing.push(t('rfqs.fields.itemName'));
  if (!draft.value.unitPrice.trim()) missing.push(t('rfqs.fields.unitPrice'));
  if (!draft.value.quantity.trim()) missing.push(t('rfqs.fields.quantity'));
  if (!draft.value.port.trim()) missing.push(t('rfqs.fields.port'));
  return missing;
});
const attachmentDisabledReason = computed(() =>
  attachmentMutationBlocked.value
    ? operationAvailabilityMessage(
        rfqMutations.reasonCode('uploadRfqAttachment'),
        t('rfqs.mutation.uploadUnavailable')
      )
    : ''
);
const quotationDisabledReason = computed(() => {
  if (quotationMutationBlocked.value) {
    return operationAvailabilityMessage(
      rfqMutations.reasonCode('submitRfqQuotation'),
      t('rfqs.mutation.submitUnavailable')
    );
  }
  if (submitQuotation.isPending.value) return t('rfqs.mutation.submitting');
  if (missingQuotationFields.value.length) {
    return t('rfqs.mutation.fillFirst', { fields: missingQuotationFields.value.join(', ') });
  }
  return '';
});

const submitQuotation = useMutation({
  mutationFn: () => gateway.request('submitRfqQuotation', quotationPayload()),
  onSuccess: () => toast.success(t('rfqs.feedback.submitted'))
});
const uploadAttachment = useMutation({
  mutationFn: (payload: RfqAttachmentUploadRequest) => gateway.request('uploadRfqAttachment', payload),
  onSuccess: (result) => {
    draft.value.attachmentFilesString = result.filesString;
    saveDraft();
    toast.success(t('rfqs.feedback.attachmentUploaded'));
  }
});

function quotationPayload(): RfqQuotationRequest {
  return {
    rfqId: selectedRfqId.value,
    message: draft.value.message,
    paymentTerms: draft.value.paymentTerms,
    expiresAt: `${draft.value.expiresAt} 23:59:59`,
    prices: [
      {
        itemName: draft.value.itemName,
        unitPrice: draft.value.unitPrice,
        currency: draft.value.currency,
        quantity: draft.value.quantity,
        quantityUnit: draft.value.quantityUnit,
        shippingTerms: draft.value.shippingTerms,
        port: draft.value.port,
        remark: draft.value.remark
      }
    ],
    ...(draft.value.attachmentFilesString ? { attachmentFilesString: draft.value.attachmentFilesString } : {})
  };
}

function selectRfq(rfq: RfqSummary): void {
  selectedRfqId.value = rfq.id;
  rfqSheetOpen.value = true;
}

function draftKey(rfqId: string): string {
  return `one-vegetable:rfq-draft:${rfqId}`;
}

function saveDraft(): void {
  if (!selectedRfqId.value) return;
  globalThis.localStorage.setItem(draftKey(selectedRfqId.value), JSON.stringify(draft.value));
  draftSaved.value = true;
  globalThis.setTimeout(() => {
    draftSaved.value = false;
  }, 1800);
}

function restoreDraft(rfqId: string): void {
  const summary = (rfqs.data.value?.items ?? []).find((rfq) => rfq.id === rfqId);
  const stored = globalThis.localStorage.getItem(draftKey(rfqId));
  if (!stored) {
    draft.value = emptyDraft(summary);
    return;
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    draft.value = isQuotationDraft(parsed) ? parsed : emptyDraft(summary);
  } catch {
    draft.value = emptyDraft(summary);
  }
}

async function selectAttachment(event: Event): Promise<void> {
  attachmentError.value = '';
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
  if (attachmentMutationBlocked.value) {
    attachmentError.value = operationAvailabilityMessage(
      rfqMutations.reasonCode('uploadRfqAttachment'),
      t('rfqs.mutation.uploadUnavailable')
    );
    input.value = '';
    return;
  }
  const file = input.files[0];
  attachmentName.value = file.name;
  try {
    uploadAttachment.mutate({
      fileName: file.name,
      contentBase64: await fileToBase64(file),
      contentType: file.type || 'application/octet-stream',
      byteLength: file.size
    });
  } catch (error: unknown) {
    attachmentError.value = error instanceof Error ? error.message : t('rfqs.errors.attachmentRead');
  } finally {
    input.value = '';
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error(t('rfqs.errors.attachmentRead')));
    };
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(t('rfqs.errors.attachmentRead')));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

function isQuotationDraft(value: unknown): value is QuotationDraft {
  if (typeof value !== 'object' || value === null) return false;
  const keys: (keyof QuotationDraft)[] = [
    'message',
    'paymentTerms',
    'expiresAt',
    'itemName',
    'unitPrice',
    'currency',
    'quantity',
    'quantityUnit',
    'shippingTerms',
    'port',
    'remark',
    'attachmentFilesString'
  ];
  return keys.every((key) => key in value && typeof (value as Record<string, unknown>)[key] === 'string');
}

watch(selectedRfqId, (rfqId) => {
  submitQuotation.reset();
  attachmentError.value = '';
  attachmentName.value = '';
  if (rfqId) restoreDraft(rfqId);
});

watch(source, () => {
  rfqPage.value = 1;
});

function applySearch(): void {
  appliedFilters.value = {
    keywords: keywords.value.trim(),
    country: country.value.trim().toUpperCase(),
    unquotedOnly: unquotedOnly.value
  };
  rfqPage.value = 1;
}

function isRfqPermissionDenied(error: unknown): boolean {
  if (!error) return false;
  const normalized = normalizeGatewayError(error);
  return (
    normalized.code === '11' &&
    /permission|api-package-limit|authorize|scope|access|forbidden/i.test(
      normalized.subCode ?? normalized.message
    )
  );
}

const columns = computed<DataColumn<RfqSummary>[]>(() => [
  {
    accessorKey: 'subject',
    header: t('rfqs.columns.demand'),
    cell: ({ row }) =>
      h(
        'button',
        {
          class: 'max-w-80 text-left font-medium text-primary hover:underline',
          onClick: () => {
            selectRfq(row.original);
          }
        },
        row.original.subject
      )
  },
  {
    id: 'quantity',
    header: t('rfqs.columns.quantity'),
    cell: ({ row }) =>
      row.original.quantity === null
        ? '—'
        : `${row.original.quantity.toLocaleString()} ${row.original.quantityUnit ?? ''}`
  },
  { accessorKey: 'countryCode', header: t('rfqs.columns.country') },
  {
    id: 'remainingQuotes',
    header: t('rfqs.columns.remaining'),
    cell: ({ row }) => row.original.remainingQuotes ?? '—'
  },
  {
    id: 'read',
    header: t('rfqs.columns.status'),
    cell: ({ row }) => {
      const read = readStatus.data.value?.statuses[row.original.id] ?? row.original.read;
      return h(Badge, { variant: read ? 'outline' : 'success' }, () => t(read ? 'rfqs.read' : 'rfqs.unread'));
    }
  },
  {
    accessorKey: 'expiresAt',
    header: t('rfqs.columns.deadline'),
    cell: ({ row }) => formatDate(row.original.expiresAt, t('rfqs.notProvided'))
  }
]);
</script>

<template>
  <PageHeader :title="t('rfqs.title')" :description="t('rfqs.description')">
    <Badge
      :variant="
        mode === 'mock'
          ? 'secondary'
          : rfqPackageDenied
            ? 'warning'
            : rfqWorkspaceReady
              ? 'success'
              : 'outline'
      "
    >
      {{
        mode === 'mock'
          ? t('rfqs.status.demo')
          : rfqPackageDenied
            ? t('rfqs.status.denied')
            : rfqWorkspaceReady
              ? t('rfqs.status.ready')
              : t('rfqs.status.checking')
      }}
    </Badge>
  </PageHeader>

  <Card v-if="rfqPackageDenied" class="mb-4 border-amber-300 p-5 dark:border-amber-800">
    <div class="flex items-start gap-3">
      <ShieldAlert class="mt-0.5 size-5 shrink-0 text-amber-600" />
      <div class="min-w-0 flex-1">
        <h2 class="font-semibold">{{ t('rfqs.permissions.deniedTitle') }}</h2>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">
          {{
            t('rfqs.permissions.deniedDescription', {
              code: rfqAccessError?.code ?? '11',
              subCode: rfqAccessError?.subCode ?? 'isv.permission-api-package-limit'
            })
          }}
        </p>
        <p v-if="rfqAccessError?.traceId" class="mt-2 break-all font-mono text-xs text-muted-foreground">
          traceId：{{ rfqAccessError.traceId }}
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <a
            href="https://sourcing.alibaba.com/"
            class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            target="_blank"
            rel="noreferrer"
          >
            {{ t('rfqs.permissions.marketplace') }}<ExternalLink class="size-3.5" />
          </a>
          <Button variant="outline" size="sm" :disabled="equity.isFetching.value" @click="equity.refetch()">
            {{ equity.isFetching.value ? t('rfqs.permissions.checking') : t('rfqs.permissions.retry') }}
          </Button>
          <a
            href="https://developer.alibaba.com/docs/api.htm?apiId=32084"
            class="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            {{ t('rfqs.permissions.docs') }}
          </a>
        </div>
      </div>
    </div>
  </Card>

  <Card v-else-if="equity.error.value" class="mb-4 border-destructive p-5">
    <div class="flex items-start gap-3">
      <ShieldAlert class="mt-0.5 size-5 shrink-0 text-destructive" />
      <div>
        <h2 class="font-semibold">{{ t('rfqs.permissions.failedTitle') }}</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          {{ rfqAccessError?.message ?? t('rfqs.permissions.retryLater') }}
        </p>
        <Button class="mt-4" variant="outline" size="sm" @click="equity.refetch()">
          {{ t('rfqs.permissions.retryShort') }}
        </Button>
      </div>
    </div>
  </Card>

  <template v-if="rfqWorkspaceReady">
    <Card
      v-if="realMutationBlocked"
      class="mb-4 flex items-start gap-3 border-amber-300 p-4 text-sm dark:border-amber-800"
    >
      <ShieldAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div>
        <p class="font-medium">{{ t('rfqs.mutation.closedTitle') }}</p>
        <p class="mt-1 text-xs leading-5 text-muted-foreground">
          {{ t('rfqs.mutation.closedDescription', { reason: mutationAvailabilityReason }) }}
        </p>
      </div>
    </Card>

    <div class="mb-4 grid gap-3 md:grid-cols-3">
      <Card class="p-4">
        <p class="text-xs text-muted-foreground">{{ t('rfqs.equity.quotes') }}</p>
        <p class="mt-1 text-2xl font-semibold">{{ equity.data.value?.remainingQuotes ?? '—' }}</p>
      </Card>
      <Card class="p-4">
        <p class="text-xs text-muted-foreground">{{ t('rfqs.equity.topQuotes') }}</p>
        <p class="mt-1 text-2xl font-semibold">{{ equity.data.value?.remainingTopQuotes ?? '—' }}</p>
      </Card>
      <Card class="p-4">
        <p class="text-xs text-muted-foreground">{{ t('rfqs.equity.score') }}</p>
        <p class="mt-1 text-2xl font-semibold">{{ equity.data.value?.score ?? '—' }}</p>
      </Card>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <Button :variant="source === 'search' ? 'default' : 'outline'" @click="source = 'search'">
        <Search class="size-4" />{{ t('rfqs.market') }}
      </Button>
      <Button :variant="source === 'recommend' ? 'default' : 'outline'" @click="source = 'recommend'">
        <Sparkles class="size-4" />{{ t('rfqs.recommended') }}
      </Button>
      <div v-if="source === 'search'" class="relative min-w-64 flex-1">
        <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          v-model="keywords"
          class="pl-9"
          :placeholder="t('rfqs.searchPlaceholder')"
          @keyup.enter="applySearch"
        />
      </div>
      <Input
        v-if="source === 'search'"
        v-model="country"
        class="w-32"
        :placeholder="t('rfqs.countryPlaceholder')"
        @keyup.enter="applySearch"
      />
      <label v-if="source === 'search'" class="flex items-center gap-2 text-sm text-muted-foreground">
        <input v-model="unquotedOnly" type="checkbox" />{{ t('rfqs.unquotedOnly') }}
      </label>
      <Button v-if="source === 'search'" variant="outline" @click="applySearch">
        <Search class="size-4" />{{ t('rfqs.search') }}
      </Button>
    </div>

    <QueryState
      :loading="rfqListLoading"
      :error="rfqs.error.value"
      :retryable="rfqWorkspaceReady"
      @retry="rfqs.refetch()"
    >
      <DataTable
        :columns="columns"
        :data="rfqs.data.value?.items ?? []"
        v-model:page="rfqPage"
        v-model:page-size="rfqPageSize"
        :total-rows="rfqs.data.value?.total ?? 0"
        :page-size-options="[10, 20]"
        :pagination-disabled="rfqs.isFetching.value"
        :empty-text="t('rfqs.noMatch')"
        min-width="840px"
        :get-row-key="(rfq) => rfq.id"
        :active-row-key="rfqSheetOpen ? selectedRfqId : undefined"
        :row-aria-label="(rfq) => t('rfqs.view', { subject: rfq.subject })"
        @row-activate="selectRfq"
      />
    </QueryState>

    <Sheet
      :open="rfqSheetOpen"
      :title="detail.data.value?.subject ?? selectedSummary?.subject ?? t('rfqs.detailTitle')"
      :description="selectedRfqId ? `RFQ ${selectedRfqId}` : undefined"
      @update:open="rfqSheetOpen = $event"
    >
      <template #toolbar>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Badge :variant="detail.data.value?.recommended ? 'success' : 'outline'">
            {{ detail.data.value?.recommended ? t('rfqs.recommended') : t('rfqs.market') }}
          </Badge>
          <span class="text-xs text-muted-foreground">{{ t('rfqs.sidebarDescription') }}</span>
        </div>
      </template>

      <div v-if="selectedRfqId" class="space-y-5">
        <Card class="p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {{ t('rfqs.detail.label') }}
              </p>
              <p class="mt-1 text-sm text-muted-foreground">{{ t('rfqs.detail.description') }}</p>
            </div>
          </div>
          <QueryState
            :loading="detail.isPending.value"
            :error="detail.error.value"
            retryable
            @retry="detail.refetch()"
          >
            <p class="mt-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {{ detail.data.value?.description || t('rfqs.detail.noDescription') }}
            </p>
            <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt class="text-xs text-muted-foreground">{{ t('rfqs.detail.category') }}</dt>
                <dd>{{ detail.data.value?.categoryName ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">{{ t('rfqs.detail.destinationPort') }}</dt>
                <dd>{{ detail.data.value?.destinationPort ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">{{ t('rfqs.detail.paymentTerms') }}</dt>
                <dd>{{ detail.data.value?.paymentTerms ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">{{ t('rfqs.detail.shippingTerms') }}</dt>
                <dd>{{ detail.data.value?.shippingTerms ?? '—' }}</dd>
              </div>
            </dl>
            <div v-if="detail.data.value?.attachments.length" class="mt-5 rounded-lg bg-muted p-3">
              <p class="text-xs font-medium text-muted-foreground">{{ t('rfqs.detail.attachments') }}</p>
              <a
                v-for="attachment in detail.data.value.attachments"
                :key="attachment.url"
                :href="attachment.url"
                class="mt-2 flex items-center gap-2 text-sm text-primary hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                <FileText class="size-4" />{{ attachment.name }}
              </a>
            </div>
          </QueryState>
        </Card>

        <Card class="p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {{ t('rfqs.draft.title') }}
              </p>
              <p class="mt-1 text-sm text-muted-foreground">{{ t('rfqs.draft.description') }}</p>
            </div>
            <Badge v-if="draftSaved" variant="success">{{ t('rfqs.draft.saved') }}</Badge>
          </div>

          <div
            v-if="realMutationBlocked"
            class="mt-4 flex gap-2 rounded-lg border border-amber-300 p-3 text-sm"
          >
            <ShieldAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />{{
              t('rfqs.mutation.localAvailable', { reason: mutationAvailabilityReason })
            }}
          </div>

          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <label class="text-xs text-muted-foreground sm:col-span-2"
              >{{ t('rfqs.fields.message') }}
              <textarea
                v-model="draft.message"
                class="mt-1 min-h-24 w-full rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label class="text-xs text-muted-foreground"
              >{{ t('rfqs.fields.itemName') }}<Input v-model="draft.itemName" class="mt-1"
            /></label>
            <label class="text-xs text-muted-foreground"
              >{{ t('rfqs.fields.expiresAt') }}<Input v-model="draft.expiresAt" class="mt-1" type="date"
            /></label>
            <label class="text-xs text-muted-foreground"
              >{{ t('rfqs.fields.unitPrice')
              }}<Input v-model="draft.unitPrice" class="mt-1" placeholder="599.00"
            /></label>
            <label class="text-xs text-muted-foreground"
              >{{ t('rfqs.fields.currency') }}<Input v-model="draft.currency" class="mt-1"
            /></label>
            <label class="text-xs text-muted-foreground"
              >{{ t('rfqs.fields.quantity') }}<Input v-model="draft.quantity" class="mt-1"
            /></label>
            <label class="text-xs text-muted-foreground"
              >{{ t('rfqs.fields.quantityUnit') }}<Input v-model="draft.quantityUnit" class="mt-1"
            /></label>
            <label class="text-xs text-muted-foreground"
              >{{ t('rfqs.fields.shippingTerms') }}<Input v-model="draft.shippingTerms" class="mt-1"
            /></label>
            <label class="text-xs text-muted-foreground"
              >{{ t('rfqs.fields.port') }}<Input v-model="draft.port" class="mt-1"
            /></label>
            <label class="text-xs text-muted-foreground"
              >{{ t('rfqs.fields.paymentTerms') }}<Input v-model="draft.paymentTerms" class="mt-1"
            /></label>
            <label class="text-xs text-muted-foreground"
              >{{ t('rfqs.fields.remark') }}<Input v-model="draft.remark" class="mt-1"
            /></label>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" @click="saveDraft"
              ><Save class="size-4" />{{ t('rfqs.draft.save') }}</Button
            >
            <ActionTooltip :disabled="attachmentMutationBlocked" :reason="attachmentDisabledReason">
              <label
                class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-accent"
                :class="attachmentMutationBlocked ? 'pointer-events-none opacity-50' : ''"
              >
                <Paperclip class="size-4" />{{ attachmentName || t('rfqs.draft.attachment') }}
                <input
                  type="file"
                  class="sr-only"
                  :disabled="attachmentMutationBlocked"
                  @change="selectAttachment"
                />
              </label>
            </ActionTooltip>
            <ActionTooltip :disabled="Boolean(quotationDisabledReason)" :reason="quotationDisabledReason">
              <Button :disabled="Boolean(quotationDisabledReason)" @click="submitQuotation.mutate()">
                <Send class="size-4" />{{ t('rfqs.draft.submit') }}
              </Button>
            </ActionTooltip>
          </div>
          <p
            v-if="!quotationMutationBlocked && missingQuotationFields.length"
            class="mt-2 text-xs text-amber-700 dark:text-amber-400"
          >
            {{ t('rfqs.draft.missing', { fields: missingQuotationFields.join(', ') }) }}
          </p>
          <p v-if="attachmentError" class="mt-2 text-sm text-destructive">{{ attachmentError }}</p>
          <ErrorNotice
            v-if="uploadAttachment.error.value"
            class="mt-2"
            :error="uploadAttachment.error.value"
            compact
          />
          <ErrorNotice
            v-if="submitQuotation.error.value"
            class="mt-2"
            :error="submitQuotation.error.value"
            compact
          />
          <p
            v-if="submitQuotation.data.value"
            class="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {{
              t('rfqs.draft.quotationId', {
                message: mode === 'mock' ? t('rfqs.draft.demoSuccess') : t('rfqs.draft.success'),
                id: submitQuotation.data.value.quotationId
              })
            }}
          </p>
        </Card>
      </div>
    </Sheet>
  </template>
</template>
