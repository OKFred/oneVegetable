<script setup lang="ts">
import { computed, ref } from 'vue';
import { History, Pause, Play, RefreshCw } from '@lucide/vue';
import { toast } from 'vue-sonner';
import {
  galleryTaskReport,
  sameGalleryTransferContext,
  type GalleryTransferTaskV1
} from '@one-vegetable/core/gallery-transfer-task';
import { safeCode } from '@one-vegetable/core/gallery-transfer-runner';
import { useGalleryTransfers, downloadGalleryFile } from '../lib/gallery-transfer-service';
import { formatDateTime } from '../lib/date-time';
import { useUiI18n } from '../i18n';
import Sheet from './ui/Sheet.vue';
import Button from './ui/Button.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';

const transfers = useGalleryTransfers();
const { t } = useUiI18n();
const filter = ref('all');
const busy = ref(false);
const pending = ref<{
  task: GalleryTransferTaskV1;
  action: 'resume' | 'verify' | 'cancel' | 'remove' | 'skip';
  itemId?: string;
} | null>(null);
const skipReason = ref('');
const task = computed(() => transfers?.tasks.value.find((v) => v.id === transfers.selectedId.value));
const tasks = computed(
  () => transfers?.tasks.value.filter((v) => filter.value === 'all' || v.status === filter.value) ?? []
);
const active = computed(() => transfers?.tasks.value.find((v) => v.status === 'running'));
const contextChanged = computed(
  () =>
    !!(
      task.value &&
      transfers?.currentContext.value &&
      !sameGalleryTransferContext(task.value.context, transfers.currentContext.value)
    )
);
const reselect = ref<HTMLInputElement | null>(null);
async function safely(action: () => Promise<void>): Promise<void> {
  busy.value = true;
  try {
    await action();
  } catch (e) {
    toast.error(t('photos.tasks.error', { code: safeCode(e) }));
  } finally {
    busy.value = false;
    await transfers?.reload();
  }
}
async function confirm(): Promise<void> {
  const command = pending.value;
  if (!command || !transfers) return;
  if (command.action === 'skip' && !skipReason.value.trim()) return;
  pending.value = null;
  await safely(async () => {
    if (command.action === 'cancel') await transfers.runner.command(command.task.id, 'cancel');
    else if (command.action === 'remove') {
      await transfers.repository.remove(command.task.id);
      transfers.driver.forgetArchive(command.task.id);
    } else if (command.action === 'skip' && command.itemId)
      await transfers.runner.skip(command.task.id, command.itemId, skipReason.value);
    else {
      void transfers.run(command.task.id, command.action === 'verify');
    }
  });
}
async function selectArchive(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const current = task.value;
  if (!file || !current || !transfers) return;
  await safely(async () => {
    if (file.size > 50 * 1024 * 1024) throw new Error('GALLERY_TASK_ARCHIVE_CHANGED');
    await transfers.driver.attachArchive(current, new Uint8Array(await file.arrayBuffer()));
    toast.success(t('photos.tasks.archiveReady'));
  });
}
function report(current: GalleryTransferTaskV1): void {
  downloadGalleryFile(
    `gallery-transfer-${current.id}.json`,
    new TextEncoder().encode(JSON.stringify(galleryTaskReport(current), null, 2)),
    'application/json'
  );
}
async function pause(): Promise<void> {
  if (task.value && transfers) await transfers.runner.command(task.value.id, 'pause');
}
</script>
<template>
  <template v-if="transfers">
    <Button
      v-if="active"
      variant="outline"
      size="sm"
      class="fixed bottom-6 left-1/2 z-40 max-w-[75vw] -translate-x-1/2 shadow-lg"
      @click="transfers.show(active.id)"
    >
      <History class="size-4" />{{
        t('photos.tasks.progress', {
          count: active.items.filter((i) => i.status === 'confirmed').length,
          total: active.items.length
        })
      }}
    </Button>
    <Sheet
      v-model:open="transfers.open.value"
      :title="t('photos.tasks.title')"
      :description="t('photos.tasks.boundary')"
    >
      <template #toolbar>
        <div class="flex flex-wrap gap-2">
          <select
            v-model="filter"
            class="rounded-md border bg-background px-2 py-1"
            :aria-label="t('photos.tasks.filter')"
          >
            <option value="all">{{ t('photos.tasks.all') }}</option>
            <option
              v-for="status in ['pending', 'running', 'paused', 'attention', 'completed', 'cancelled']"
              :key="status"
              :value="status"
            >
              {{ t('photos.tasks.status.' + status) }}
            </option>
          </select>
          <Button variant="outline" size="sm" @click="transfers.refresh()"
            ><RefreshCw class="size-4" />{{ t('photos.tasks.refresh') }}</Button
          >
        </div>
      </template>
      <p v-if="transfers.error.value" role="alert" class="mb-3 text-sm text-destructive">
        {{ t('photos.tasks.error', { code: transfers.error.value }) }}
      </p>
      <div class="space-y-2">
        <Button
          v-for="record in tasks"
          :key="record.id"
          variant="outline"
          class="h-auto w-full justify-between whitespace-normal text-left"
          @click="transfers.selectedId.value = record.id"
        >
          <span
            >{{ t('photos.tasks.direction.' + record.direction) }} · {{ record.storage.toUpperCase() }} ·
            {{ record.id.slice(0, 8)
            }}<small class="block">{{ formatDateTime(record.createTimeUtc) }}</small></span
          >
          <span>{{ t('photos.tasks.status.' + record.status) }}</span>
        </Button>
        <p v-if="!tasks.length" class="text-sm text-muted-foreground">{{ t('photos.tasks.empty') }}</p>
      </div>
      <section v-if="task" class="mt-5 space-y-3 rounded-lg border p-3">
        <h3 class="font-semibold">{{ t('photos.tasks.detail') }} · {{ task.id.slice(0, 8) }}</h3>
        <p class="break-all text-xs">{{ task.batchPrefix }}</p>
        <p v-if="task.errorCode" role="alert" class="text-sm text-destructive">
          {{ t('photos.tasks.error', { code: task.errorCode }) }}
        </p>
        <div
          v-if="contextChanged || task.errorCode || transfers.error.value"
          class="flex flex-wrap gap-3 text-sm"
        >
          <span v-if="contextChanged">{{ t('photos.tasks.changedContext') }}</span>
          <a href="#/settings" class="underline" @click="transfers.open.value = false">{{
            t('settings.page.title')
          }}</a>
          <a href="#/photos" class="underline" @click="transfers.open.value = false">{{
            t('photos.tasks.newPreview')
          }}</a>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            v-if="task.status === 'running'"
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="safely(pause)"
            ><Pause class="size-4" />{{ t('photos.tasks.pause') }}</Button
          >
          <Button
            v-else-if="!['completed', 'cancelled'].includes(task.status)"
            size="sm"
            :disabled="busy || contextChanged"
            @click="pending = { task, action: 'resume' }"
            ><Play class="size-4" />{{ t('photos.tasks.resume') }}</Button
          >
          <Button
            v-if="
              task.status !== 'running' &&
              task.items.some((i) => ['unknown', 'unconfirmed'].includes(i.status))
            "
            variant="outline"
            size="sm"
            :disabled="busy || contextChanged"
            @click="pending = { task, action: 'verify' }"
            >{{ t('photos.tasks.verify') }}</Button
          >
          <Button
            v-if="!['completed', 'cancelled'].includes(task.status)"
            variant="outline"
            size="sm"
            @click="pending = { task, action: 'cancel' }"
            >{{ t('photos.tasks.cancel') }}</Button
          >
          <Button
            v-if="task.status !== 'running'"
            variant="outline"
            size="sm"
            @click="pending = { task, action: 'remove' }"
            >{{ t('photos.tasks.remove') }}</Button
          >
          <Button variant="outline" size="sm" @click="report(task)">{{ t('photos.tasks.report') }}</Button>
          <Button
            v-if="task.direction === 'import' && task.storage === 'zip' && task.status !== 'running'"
            variant="outline"
            size="sm"
            @click="reselect?.click()"
            >{{ t('photos.tasks.reselect') }}</Button
          >
          <input
            ref="reselect"
            type="file"
            accept=".zip"
            class="sr-only"
            :aria-label="t('photos.tasks.reselect')"
            @change="selectArchive"
          />
        </div>
        <p class="text-xs text-muted-foreground">{{ t('photos.tasks.noRepeat') }}</p>
        <p
          v-if="task.storage === 'zip' && task.direction === 'export' && task.status === 'completed'"
          role="status"
        >
          {{ t('photos.tasks.downloadStarted') }}
        </p>
        <div v-for="item in task.items" :key="item.id" class="space-y-1 border-t py-2 text-xs">
          <div class="flex items-start justify-between gap-2">
            <span class="break-all">{{ item.fileName }} · {{ t('photos.tasks.kind.' + item.kind) }}</span
            ><span class="shrink-0">{{ t('photos.tasks.item.' + item.status) }}</span>
          </div>
          <p class="break-all text-muted-foreground">
            {{ item.targetPath }}<template v-if="item.fileId"> · fileId: {{ item.fileId }}</template>
          </p>
          <p v-if="item.requestId" class="break-all text-muted-foreground">requestId: {{ item.requestId }}</p>
          <p v-if="item.errorCode" class="text-amber-700 dark:text-amber-300">
            {{ t('photos.tasks.error', { code: item.errorCode }) }}
          </p>
          <p v-if="item.skipReason">{{ item.skipReason }}</p>
          <Button
            v-if="task.status !== 'running' && ['failed', 'unconfirmed', 'unknown'].includes(item.status)"
            variant="outline"
            size="sm"
            @click="
              skipReason = '';
              pending = { task, action: 'skip', itemId: item.id };
            "
            >{{ t('photos.tasks.skip') }}</Button
          >
        </div>
      </section>
    </Sheet>
    <ConfirmActionDialog
      :open="pending !== null"
      :title="t('photos.tasks.confirm')"
      :description="t(pending?.action === 'remove' ? 'photos.tasks.clearWarning' : 'photos.tasks.noRepeat')"
      :pending="busy"
      @update:open="
        (value) => {
          if (!value) pending = null;
        }
      "
      @confirm="confirm"
    >
      <label v-if="pending?.action === 'skip'" class="block"
        >{{ t('photos.tasks.reason')
        }}<input v-model="skipReason" maxlength="500" class="mt-1 w-full rounded-md border bg-background p-2"
      /></label>
    </ConfirmActionDialog>
  </template>
</template>
