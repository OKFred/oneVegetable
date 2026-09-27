<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onScopeDispose, ref, watch } from 'vue';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';
import { parseAppHash } from '../lib/hash-router';
import PageHeader from '../components/PageHeader.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import Button from '../components/ui/Button.vue';

const ServerEventLogPanel = defineAsyncComponent(() => import('../components/ServerEventLogPanel.vue'));
const LocalDiagnosticsPanel = defineAsyncComponent(() => import('../components/LocalDiagnosticsPanel.vue'));
const { control, mode } = useServices();
const { t } = useUiI18n();
const identity = useListIdentityScope();
type Section = 'requests' | 'audit' | 'local';
const requestedSection = ref(parseAppHash(globalThis.location.hash)?.segments[0]);
const checking = ref(true),
  administrator = ref(false);
const error = ref<unknown>(null);
const requestId = ref('');
let generation = 0;
const sections = computed<Section[]>(() =>
  administrator.value ? ['requests', 'audit', 'local'] : ['local']
);
const section = computed<Section>(() => {
  const value = requestedSection.value;
  if (value === 'requests' || value === 'audit' || value === 'local') return value;
  return administrator.value ? 'requests' : 'local';
});
function updateRoute(): void {
  requestedSection.value = parseAppHash(globalThis.location.hash)?.segments[0];
}
async function checkAccess(): Promise<void> {
  const current = ++generation;
  checking.value = true;
  administrator.value = false;
  error.value = null;
  requestId.value = '';
  try {
    if (mode === 'bff' && control) {
      const session = await control.session();
      if (current === generation) administrator.value = session.principal.role === 'admin';
    }
  } catch (cause: unknown) {
    if (current === generation)
      error.value = cause instanceof Error ? cause : new Error(t('logs.accessFailed'));
  } finally {
    if (current === generation) checking.value = false;
  }
}
watch(identity, checkAccess, { immediate: true });
onMounted(() => {
  globalThis.addEventListener('hashchange', updateRoute);
});
onScopeDispose(() => {
  generation++;
  globalThis.removeEventListener('hashchange', updateRoute);
});
</script>

<template>
  <PageHeader :title="t('logs.title')" :description="t('logs.description')" />
  <p v-if="checking" role="status" class="text-sm text-muted-foreground">{{ t('logs.checking') }}</p>
  <div v-else class="min-w-0 space-y-4">
    <nav :aria-label="t('logs.navigation')" class="flex flex-wrap gap-2 border-b pb-2">
      <a
        v-for="item in sections"
        :key="item"
        :href="`#/logs/${item}`"
        class="rounded-md px-4 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="section === item ? 'bg-muted font-semibold' : 'text-muted-foreground'"
        :aria-current="section === item ? 'page' : undefined"
        >{{ t(`logs.sections.${item}`) }}</a
      >
    </nav>
    <div v-if="error" class="space-y-2">
      <ErrorNotice :error="error" compact />
      <Button variant="outline" @click="checkAccess">{{ t('logs.retry') }}</Button>
    </div>
    <p v-if="!administrator" class="text-sm text-muted-foreground">
      {{ t(mode === 'bff' ? 'logs.adminOnly' : 'logs.localOnly') }}
    </p>
    <LocalDiagnosticsPanel v-if="section === 'local'" :key="identity" />
    <ServerEventLogPanel
      v-else-if="administrator"
      :key="`${identity}:${section}`"
      v-model:request-id="requestId"
      :kind="section"
    />
  </div>
</template>
