<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  onMounted,
  onUnmounted,
  provide,
  ref,
  shallowRef,
  watch
} from 'vue';
import { Download, Eye, File, FileUp, Folder, FolderPlus, RefreshCw, Upload } from '@lucide/vue';
import { toast } from 'vue-sonner';
import {
  useMenuItems,
  type ConfigDefaults,
  type DirEntry,
  type FeaturesConfig,
  type ItemDclickEvent
} from 'vuefinder';
import 'vuefinder/dist/vuefinder.css';

import PageHeader from '../components/PageHeader.vue';
import ListActionButton from '../components/ListActionButton.vue';
import ListViewToggle from '../components/ListViewToggle.vue';
import ConfirmActionDialog from '../components/ConfirmActionDialog.vue';
import Button from '../components/ui/Button.vue';
import Input from '../components/ui/Input.vue';
import ModalDialog from '../components/ui/ModalDialog.vue';
import Tooltip from '../components/ui/Tooltip.vue';
import { useFilesI18n } from '../i18n/files';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { formatDateTime } from '../lib/date-time';
import {
  createOrderAttachmentFile,
  ORDER_ATTACHMENT_LIMIT
} from '@one-vegetable/core/order-attachment-platform';
import type { EncodedFilePayload } from '@one-vegetable/core/encoded-file';
import { useOrderAttachmentsI18n } from '../i18n/order-attachments';
import {
  fileStorage,
  prepareFileCreate,
  S3FileDriver,
  S3_FILE_LIMIT,
  storageConfigurationId,
  safeFilePreview,
  type FileCreatePlan,
  type FilePage,
  type SafePreview
} from '../lib/s3-file-driver';

const VueFinder = defineAsyncComponent(async () => (await import('vuefinder')).VueFinder);
const OrderAttachmentDialog = defineAsyncComponent(() => import('../components/OrderAttachmentDialog.vue'));
const attachmentText = useOrderAttachmentsI18n();
const attachmentSource = shallowRef<{ name: string; load: () => Promise<EncodedFilePayload> } | null>(null);
const localeModules = (
  import.meta as ImportMeta & {
    glob<T>(pattern: string): Record<string, () => Promise<T>>;
  }
).glob<{ default: Record<string, string> }>('../../node_modules/vuefinder/dist/locales/{en,zhCN}.js');
provide('VueFinderOptions', {
  i18n: {
    en: localeModules['../../node_modules/vuefinder/dist/locales/en.js'],
    zhCN: localeModules['../../node_modules/vuefinder/dist/locales/zhCN.js']
  }
});
const ft = useFilesI18n();
const { locale } = useUiI18n();
const services = useServices();
const storage = fileStorage(services.s3Storage ?? services.control);
const identity = useListIdentityScope();
const driver = shallowRef<S3FileDriver | null>(null);
const initialPage = (): FilePage => ({
  prefix: '',
  number: 1,
  next: false,
  previous: false,
  count: 0,
  loading: false
});
const page = ref(initialPage());
const connecting = ref(false);
const path = ref('');
const renderKey = ref(0);
const finderId = 's3-files-' + globalThis.crypto.randomUUID();
const view = ref<'cards' | 'list'>('cards');
const search = ref('');
// 4.7.6 keeps its internal layout ahead of config defaults; use its public view action.
const FinderViewSync = defineComponent({
  setup() {
    const { menuItems } = useMenuItems();
    watch(
      view,
      (value) => {
        menuItems.value
          .find((menu) => menu.id === 'view')
          ?.items?.find((item) => item.id === (value === 'cards' ? 'grid-view' : 'list-view'))
          ?.action?.();
      },
      { immediate: true }
    );
    return () => null;
  }
});
const selected = shallowRef<DirEntry | null>(null);
type MessageKey = Parameters<ReturnType<typeof useFilesI18n>>[0];
const error = ref<MessageKey | null>(null);
const writing = ref(false);
const preparing = ref(false);
const reading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const folderOpen = ref(false);
const folderName = ref('');
let folderTarget = '';
const plan = shallowRef<{ driver: S3FileDriver; value: FileCreatePlan } | null>(null);
const previewOpen = ref(false);
const preview = shallowRef<SafePreview | null>(null);
const previewUrl = ref('');
const dark = ref(false);
let generation = 0;
let readGeneration = 0;
let disposed = false;
let observer: MutationObserver | undefined;
const urls = new Set<string>();

const features: FeaturesConfig = {
  edit: false,
  newfile: false,
  newfolder: false,
  preview: false,
  archive: false,
  unarchive: false,
  search: false,
  rename: false,
  upload: false,
  delete: false,
  fullscreen: false,
  download: false,
  language: false,
  move: false,
  copy: false,
  history: false,
  theme: false,
  pinned: false
};
const finderConfig = computed<ConfigDefaults>(() => ({
  persist: false,
  initialPath: 's3://' + path.value,
  showTreeView: false,
  expandTreeByDefault: false,
  expandedTreePaths: [],
  pinnedFolders: [],
  showThumbnails: false,
  showMenuBar: false,
  showToolbar: false,
  showBreadcrumbBar: false,
  notificationsEnabled: false,
  maxFileSize: S3_FILE_LIMIT,
  view: view.value === 'cards' ? 'grid' : 'list',
  theme: dark.value ? 'midnight' : 'silver'
}));
const crumbs = computed(() => {
  const parts = path.value.split('/').filter(Boolean);
  return parts.map((name, index) => ({ name, prefix: parts.slice(0, index + 1).join('/') + '/' }));
});
const blocked = computed(() => connecting.value || page.value.loading || writing.value || preparing.value);
const tooLarge = computed(
  () =>
    selected.value?.file_size !== null &&
    selected.value?.file_size !== undefined &&
    selected.value.file_size > S3_FILE_LIMIT
);

function report(value: unknown): void {
  const code = value instanceof Error ? value.message : '';
  const keys: Record<string, MessageKey> = {
    S3_FILE_RESPONSE_INVALID: 'responseInvalid',
    S3_FILE_CONTEXT_MISSING: 'contextMissing',
    S3_FILE_CONTEXT_CHANGED: 'contextChanged',
    S3_FILE_PATH_INVALID: 'pathInvalid',
    S3_FILE_TOO_LARGE: 'tooLarge',
    S3_OBJECT_TOO_LARGE: 'tooLarge',
    S3_FILE_COLLISION: 'collision',
    S3_FILE_WRITE_UNKNOWN: 'writeUnknown'
  };
  error.value = keys[code] ?? 'readUnknown';
}
function clearPreview(): void {
  readGeneration++;
  reading.value = false;
  previewOpen.value = false;
  preview.value = null;
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    urls.delete(previewUrl.value);
  }
  previewUrl.value = '';
}
function clearSelection(): void {
  selected.value = null;
  clearPreview();
}
function cleanupFinderStorage(): void {
  // VueFinder layout metadata only; never persist a path, selection or pinned business folder.
  try {
    globalThis.localStorage.removeItem('vuefinder_config_' + finderId);
    globalThis.localStorage.removeItem(finderId + '_storage');
  } catch {
    /* Storage may be unavailable in private mode. */
  }
}
async function connect(): Promise<void> {
  const previous = driver.value;
  // Startup identity hydration is not an interrupted user operation.
  const interrupted =
    writing.value ||
    preparing.value ||
    reading.value ||
    plan.value !== null ||
    folderOpen.value ||
    previewOpen.value;
  previous?.stop();
  driver.value = null;
  const version = ++generation;
  plan.value = null;
  folderOpen.value = false;
  clearSelection();
  writing.value = false;
  preparing.value = false;
  connecting.value = true;
  if (previous && interrupted) error.value = 'contextChanged';
  else if (error.value !== 'contextChanged' && error.value !== 'writeUnknown') error.value = null;
  page.value = initialPage();
  path.value = '';
  search.value = '';
  try {
    if (!storage) return;
    const context = storageConfigurationId(await storage.s3StorageConfiguration());
    if (disposed || version !== generation) return;
    if (!context) return;
    driver.value = new S3FileDriver(
      storage,
      context,
      () => !disposed && version === generation,
      (next) => {
        if (version === generation && !disposed) page.value = next;
      },
      (cause) => {
        if (version === generation && !disposed) {
          clearSelection();
          report(cause);
        }
      }
    );
    renderKey.value++;
  } catch (cause) {
    if (!disposed && version === generation) report(cause);
  } finally {
    if (!disposed && version === generation) connecting.value = false;
  }
}
async function checkContext(): Promise<void> {
  const current = driver.value;
  if (!storage || !current) return;
  try {
    const id = storageConfigurationId(await storage.s3StorageConfiguration());
    if (driver.value === current && id !== current.context) await connect();
  } catch (cause) {
    if (driver.value === current) {
      current.stop();
      driver.value = null;
      clearSelection();
      plan.value = null;
      report(cause);
    }
  }
}
function refresh(): void {
  if (!driver.value) {
    void connect();
    return;
  }
  driver.value.refresh();
  error.value = null;
  clearSelection();
  renderKey.value++;
}
function navigate(prefix: string): void {
  if (blocked.value || !driver.value) return;
  path.value = prefix;
  search.value = '';
  error.value = null;
  clearSelection();
  driver.value.refresh();
  renderKey.value++;
}
function turnPage(direction: 'next' | 'previous'): void {
  if (blocked.value || !driver.value) return;
  driver.value.turnPage(direction);
  error.value = null;
  clearSelection();
  renderKey.value++;
}
function filterPage(): void {
  if (!driver.value || blocked.value || error.value) return;
  driver.value.filter = search.value;
  clearSelection();
  renderKey.value++;
}
function select(items: DirEntry[]): void {
  clearPreview();
  selected.value = items.length === 1 ? (items[0] ?? null) : null;
}
function useAsAttachment(): void {
  const current = driver.value;
  const row = selected.value ? { ...selected.value } : null;
  if (!current || row?.type !== 'file' || blocked.value || reading.value) return;
  attachmentSource.value = {
    name: row.basename,
    load: async () => {
      const active = () => !disposed && driver.value === current;
      if (!active()) throw new Error('S3_FILE_CONTEXT_CHANGED');
      const content = await current.read(row);
      if (!active() || content.bytes.length !== row.file_size) throw new Error('S3_FILE_CONTEXT_CHANGED');
      return createOrderAttachmentFile(row.basename, content.bytes);
    }
  };
}
function openFolder(event: ItemDclickEvent): void {
  event.preventDefault();
  if (event.item.type === 'dir' && event.item.path.startsWith('s3://')) navigate(event.item.path.slice(5));
}
function activateItem(item: DirEntry): void {
  if (blocked.value) return;
  if (item.type === 'dir') {
    if (item.path.startsWith('s3://')) navigate(item.path.slice(5));
  } else {
    select([item]);
    void readSelected('preview');
  }
}
function finderKey(event: KeyboardEvent): void {
  if (event.target instanceof Element && event.target.closest('button')) return;
  // VueFinder 4.7.6 has unguarded Space/settings/tree hotkeys even with features disabled.
  if (event.code === 'Space' || event.code === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    if (selected.value) void readSelected('preview');
  } else if ((event.metaKey || event.ctrlKey) && ['KeyE', 'KeyS', 'Backslash'].includes(event.code)) {
    event.preventDefault();
    event.stopPropagation();
  }
}
function openFile(event: ItemDclickEvent): void {
  event.preventDefault();
  if (blocked.value) return;
  selected.value = event.item;
  void readSelected('preview');
}
async function readSelected(action: 'preview' | 'download'): Promise<void> {
  const row = selected.value;
  const current = driver.value;
  if (!row || !current || blocked.value || reading.value) return;
  clearPreview();
  const version = readGeneration;
  reading.value = true;
  error.value = null;
  try {
    const content = await current.read(row);
    if (disposed || driver.value !== current || version !== readGeneration) return;
    if (action === 'preview') {
      preview.value = safeFilePreview(content.bytes);
      if (preview.value && preview.value.kind !== 'text') {
        previewUrl.value = URL.createObjectURL(
          new Blob([Uint8Array.from(preview.value.bytes)], { type: preview.value.mime })
        );
        urls.add(previewUrl.value);
      }
      previewOpen.value = true;
    } else {
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(content.bytes)], { type: 'application/octet-stream' })
      );
      urls.add(url);
      const link = globalThis.document.createElement('a');
      link.href = url;
      link.download = row.basename;
      link.rel = 'noopener';
      globalThis.document.body.append(link);
      link.click();
      link.remove();
      globalThis.setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.delete(url);
      }, 1000);
    }
  } catch (cause) {
    if (!disposed && driver.value === current && version === readGeneration) report(cause);
  } finally {
    if (version === readGeneration) reading.value = false;
  }
}
async function chooseFile(event: Event): Promise<void> {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = '';
  const current = driver.value;
  const prefix = path.value;
  if (!file || !current || blocked.value) return;
  preparing.value = true;
  error.value = null;
  try {
    if (file.size > S3_FILE_LIMIT) throw new Error('S3_FILE_TOO_LARGE');
    prepareFileCreate(prefix, file.name, new Uint8Array(), file.type);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (disposed || driver.value !== current) return;
    plan.value = { driver: current, value: prepareFileCreate(prefix, file.name, bytes, file.type) };
  } catch (cause) {
    if (!disposed && driver.value === current) report(cause);
  } finally {
    if (driver.value === current) preparing.value = false;
  }
}
function startFolder(): void {
  error.value = null;
  folderTarget = path.value;
  folderName.value = '';
  folderOpen.value = true;
}
function prepareFolder(): void {
  if (!driver.value) return;
  try {
    plan.value = {
      driver: driver.value,
      value: prepareFileCreate(folderTarget, folderName.value, new Uint8Array(), '', true)
    };
    folderOpen.value = false;
    error.value = null;
  } catch (cause) {
    report(cause);
  }
}
async function confirmCreate(): Promise<void> {
  const frozen = plan.value;
  if (frozen?.driver !== driver.value || writing.value) return;
  writing.value = true;
  error.value = null;
  try {
    await frozen.driver.create(frozen.value);
    if (disposed || frozen.driver !== driver.value) return;
    toast.success(ft('confirmed'));
    plan.value = null;
    refresh();
  } catch (cause) {
    if (!disposed && frozen.driver === driver.value) {
      report(cause);
      plan.value = null;
    }
  } finally {
    if (frozen.driver === driver.value) writing.value = false;
  }
}
const focus = () => {
  void checkContext();
};
watch(view, () => {
  clearSelection();
  renderKey.value++;
});
watch(identity, () => {
  void connect();
});
watch(previewOpen, (open) => {
  if (!open) clearPreview();
});
onMounted(() => {
  const updateTheme = () => {
    dark.value = globalThis.document.documentElement.classList.contains('dark');
  };
  updateTheme();
  observer = new MutationObserver(updateTheme);
  observer.observe(globalThis.document.documentElement, { attributes: true, attributeFilter: ['class'] });
  globalThis.addEventListener('focus', focus);
  void connect();
});
onUnmounted(() => {
  disposed = true;
  generation++;
  driver.value?.stop();
  clearPreview();
  observer?.disconnect();
  globalThis.removeEventListener('focus', focus);
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  cleanupFinderStorage();
});
</script>

<template>
  <section data-testid="files-view" class="files-workspace">
    <PageHeader :title="ft('title')" :description="ft('description')">
      <ListActionButton :icon="RefreshCw" :disabled="blocked" data-testid="files-refresh" @click="refresh">{{
        ft('refresh')
      }}</ListActionButton>
    </PageHeader>
    <p
      v-if="error"
      role="alert"
      class="mb-3 rounded-md border border-destructive p-3 text-sm text-destructive"
    >
      {{ ft(error) }}
    </p>
    <p v-if="connecting" role="status">{{ ft('loading') }}</p>
    <div v-else-if="!driver" class="rounded-lg border bg-card p-6">
      <p>
        {{ !storage ? ft('unavailable') : error ? ft(error) : ft('unconfigured') }}
      </p>
      <a href="#/settings" class="mt-3 inline-block text-primary underline">{{ ft('settings') }}</a>
    </div>
    <template v-if="driver">
      <div
        class="files-actions mb-3 flex flex-wrap items-center gap-2"
        role="group"
        :aria-label="ft('title')"
      >
        <ListActionButton
          :icon="Upload"
          :disabled="blocked"
          data-testid="files-upload"
          @click="fileInput?.click()"
          >{{ ft('upload') }}</ListActionButton
        >
        <ListActionButton
          :icon="FolderPlus"
          :disabled="blocked"
          data-testid="files-new-folder"
          @click="startFolder"
          >{{ ft('newFolder') }}</ListActionButton
        >
        <ListActionButton
          :icon="Download"
          :disabled="blocked || reading || !selected || tooLarge"
          data-testid="files-download"
          @click="readSelected('download')"
          >{{ ft('download') }}</ListActionButton
        >
        <ListActionButton
          :icon="Eye"
          :disabled="blocked || reading || !selected || tooLarge"
          data-testid="files-preview"
          @click="readSelected('preview')"
          >{{ ft('preview') }}</ListActionButton
        >
        <Tooltip :text="attachmentText('limits')">
          <ListActionButton
            :icon="FileUp"
            :disabled="
              blocked ||
              reading ||
              !selected ||
              tooLarge ||
              selected.type !== 'file' ||
              (selected.file_size ?? 0) > ORDER_ATTACHMENT_LIMIT
            "
            data-testid="files-order-attachment"
            @click="useAsAttachment"
            >{{ attachmentText('entry') }}</ListActionButton
          >
        </Tooltip>
        <ListViewToggle
          v-model="view"
          :label="ft('display')"
          :cards-label="ft('grid')"
          :list-label="ft('list')"
        />
        <input ref="fileInput" type="file" hidden data-testid="files-input" @change="chooseFile" />
      </div>
      <form class="mb-2 flex gap-2" @submit.prevent="filterPage">
        <Input
          v-model="search"
          :aria-label="ft('search')"
          :placeholder="ft('search')"
          maxlength="200"
          data-testid="files-search"
          @input="filterPage"
        />
      </form>
      <p class="mb-1 text-xs text-muted-foreground">{{ ft('pageHint') }}</p>
      <p class="mb-3 text-xs text-muted-foreground">{{ ft('limit') }}</p>
      <nav
        :aria-label="ft('root')"
        class="mb-3 flex flex-wrap items-center gap-1 break-all text-sm"
        data-testid="files-breadcrumbs"
      >
        <Button variant="ghost" :disabled="blocked || !path" @click="navigate('')">{{ ft('root') }}</Button>
        <template v-for="crumb in crumbs" :key="crumb.prefix">
          <span aria-hidden="true">/</span>
          <Button
            variant="ghost"
            :disabled="blocked || path === crumb.prefix"
            @click="navigate(crumb.prefix)"
            >{{ crumb.name }}</Button
          >
        </template>
      </nav>
      <p v-if="page.loading || reading || preparing" role="status" class="mb-2 text-sm">
        {{ ft('loading') }}
      </p>
      <div
        class="files-finder h-[min(60vh,600px)] min-h-80 overflow-hidden rounded-lg border"
        :aria-busy="page.loading"
        @keydown.capture="finderKey"
        @dragstart.capture.prevent.stop
        @dragenter.capture.prevent.stop
        @dragover.capture.prevent.stop
        @drop.capture.prevent.stop
      >
        <VueFinder
          :key="renderKey"
          :id="finderId"
          :driver="driver"
          :config="finderConfig"
          :features="features"
          :locale="locale === 'zh-CN' ? 'zhCN' : 'en'"
          selection-mode="single"
          selection-filter-type="files"
          :context-menu-items="[]"
          @select="select"
          @file-dclick="openFile"
          @folder-dclick="openFolder"
        >
          <template #icon="{ item }">
            <button
              type="button"
              :aria-label="ft(item.type === 'dir' ? 'folder' : 'preview') + ': ' + item.basename"
              class="inline-flex items-center justify-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              @click.stop="activateItem(item)"
              @dblclick.stop
              @keydown.stop
              @keyup.stop
            >
              <Folder v-if="item.type === 'dir'" :class="view === 'list' ? 'size-4' : 'size-10'" />
              <File v-else :class="view === 'list' ? 'size-4' : 'size-10'" />
            </button>
          </template>
          <template #status-bar
            ><FinderViewSync /><span class="text-xs">{{
              ft('page', { page: page.number, count: page.count })
            }}</span></template
          >
        </VueFinder>
      </div>
      <div
        class="files-actions mt-3 flex flex-wrap items-center justify-between gap-2"
        data-testid="files-pagination"
      >
        <span class="text-sm">{{ ft('page', { page: page.number, count: page.count }) }}</span>
        <div class="flex gap-2">
          <Button variant="outline" :disabled="blocked || !page.previous" @click="turnPage('previous')">{{
            ft('previous')
          }}</Button>
          <Button variant="outline" :disabled="blocked || !page.next" @click="turnPage('next')">{{
            ft('next')
          }}</Button>
        </div>
      </div>
      <div v-if="selected" class="mt-3 break-all rounded-md border p-3 text-sm" data-testid="files-selection">
        <p>{{ selected.basename }}</p>
        <p>{{ ft('size') }}: {{ selected.file_size ?? '—' }} B</p>
        <p>
          {{ ft('modified') }}:
          {{ formatDateTime(selected.last_modified === null ? null : selected.last_modified * 1000) }}
        </p>
        <p v-if="tooLarge" class="text-destructive">{{ ft('tooLarge') }}</p>
      </div>
    </template>
    <ModalDialog v-model:open="folderOpen" :title="ft('newFolder')" :description="ft('folderHint')" size="sm">
      <label class="grid gap-2 text-sm"
        >{{ ft('folderName')
        }}<Input
          v-model="folderName"
          maxlength="255"
          data-testid="files-folder-name"
          @keydown.enter.prevent="prepareFolder"
      /></label>
      <p v-if="error" role="alert" class="mt-2 text-sm text-destructive">{{ ft(error) }}</p>
      <template #footer
        ><Button data-testid="files-prepare-folder" @click="prepareFolder">{{
          ft('confirm')
        }}</Button></template
      >
    </ModalDialog>
    <ConfirmActionDialog
      :open="plan !== null"
      :title="ft(plan?.value.directory ? 'confirmFolder' : 'confirmUpload')"
      :description="ft('confirmHint', { key: plan?.value.key ?? '' })"
      :confirm-label="ft('confirm')"
      :pending="writing"
      @update:open="
        (open) => {
          if (!open && !writing) plan = null;
        }
      "
      @confirm="confirmCreate"
    >
      <p v-if="writing" role="status">{{ ft('pending') }}</p>
    </ConfirmActionDialog>
    <ModalDialog
      v-model:open="previewOpen"
      :title="ft('preview')"
      :description="selected?.basename || ft('preview')"
      size="lg"
    >
      <img
        v-if="preview?.kind === 'image' && previewUrl"
        :src="previewUrl"
        :alt="selected?.basename ?? ''"
        class="max-h-[60vh] max-w-full object-contain"
      />
      <video
        v-else-if="preview?.kind === 'video' && previewUrl"
        :src="previewUrl"
        controls
        preload="metadata"
        class="max-h-[60vh] max-w-full"
      />
      <pre
        v-else-if="preview?.kind === 'text'"
        class="whitespace-pre-wrap break-all text-sm"
        data-testid="files-text-preview"
        >{{ preview.text }}</pre>
      <p v-else>{{ ft('unsupportedPreview') }}</p>
    </ModalDialog>
    <OrderAttachmentDialog
      v-if="attachmentSource"
      :source="attachmentSource"
      @close="attachmentSource = null"
    />
  </section>
</template>

<style scoped>
.files-actions :deep(button) {
  min-height: 36px;
}
.files-actions :deep([data-list-view-toggle] button) {
  min-height: 28px;
}
.files-finder :deep(.vuefinder) {
  height: 100%;
  --vf-bg-primary: hsl(var(--card));
  --vf-bg-secondary: hsl(var(--background));
  --vf-bg-tertiary: hsl(var(--muted));
  --vf-bg-hover: hsl(var(--accent));
  --vf-bg-selected: hsl(var(--secondary));
  --vf-bg-disabled: hsl(var(--muted));
  --vf-text-primary: hsl(var(--foreground));
  --vf-text-secondary: hsl(var(--muted-foreground));
  --vf-text-tertiary: hsl(var(--muted-foreground));
  --vf-text-disabled: hsl(var(--muted-foreground));
  --vf-text-inverse: hsl(var(--card));
  --vf-border-primary: hsl(var(--border));
  --vf-border-secondary: hsl(var(--border));
  --vf-border-focus: hsl(var(--ring));
  --vf-accent-primary: hsl(var(--primary));
  --vf-interactive-hover: hsl(var(--accent));
  --vf-interactive-active: hsl(var(--secondary));
  --vf-interactive-focus: hsl(var(--accent));
  --vf-selection-bg: hsl(var(--secondary));
  --vf-selection-border: hsl(var(--ring));
}
</style>
