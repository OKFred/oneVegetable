// @vitest-environment jsdom
import { defineComponent, h, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { validateGalleryTransferTask } from '@one-vegetable/core/gallery-transfer-task';
import fixture from '../../../mock/data/gallery-transfer-task.json';
import GalleryTransferTaskCenter from '../src/components/GalleryTransferTaskCenter.vue';
import { GalleryTransferService, provideGalleryTransfers } from '../src/lib/gallery-transfer-service';
import { uiI18n } from '../src/i18n';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  uiI18n.global.locale.value = 'zh-CN';
});
function setup() {
  const service = new GalleryTransferService({
    gateway: new MockGatewayClient(),
    mode: 'mock',
    settings: {
      load: () => Promise.reject(new Error('unused')),
      save: () => Promise.reject(new Error('unused'))
    }
  });
  const task = validateGalleryTransferTask(structuredClone(fixture));
  task.status = 'attention';
  if (!task.items[0]) throw new Error('fixture');
  task.items[0].status = 'unknown';
  service.tasks.value = [task];
  service.selectedId.value = task.id;
  service.open.value = true;
  vi.spyOn(service, 'reload').mockResolvedValue();
  const run = vi.spyOn(service, 'run').mockResolvedValue();
  const command = vi.spyOn(service.runner, 'command').mockResolvedValue();
  const Host = defineComponent({
    setup() {
      provideGalleryTransfers(service);
      return () => h(GalleryTransferTaskCenter);
    }
  });
  const wrapper = mount(Host, { attachTo: document.body });
  cleanups.push(() => {
    wrapper.unmount();
    service.dispose();
  });
  return { service, task, run, command };
}
function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (node) => node.textContent.trim() === label
  );
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
}
describe('gallery task center', () => {
  it('makes changed configuration read-only and offers settings and a new preview', async () => {
    const s = setup();
    s.service.currentContext.value = { ...s.task.context, storage: 'different-configuration' };
    await nextTick();
    expect(button('继续 / 重试明确失败项').disabled).toBe(true);
    expect(button('核对结果').disabled).toBe(true);
    expect(document.body.querySelector('a[href="#/settings"]')?.textContent.trim()).toBe('连接设置');
    expect(document.body.querySelector('a[href="#/photos"]')?.textContent).toBe('重新预览');
    expect(s.run).not.toHaveBeenCalled();
  });
  it('keeps uncertain items visible and requires confirmation before verification', async () => {
    const s = setup();
    await nextTick();
    expect(document.body.textContent).toContain('结果不明');
    button('核对结果').click();
    await flushPromises();
    expect(s.run).not.toHaveBeenCalled();
    button('确认').click();
    await flushPromises();
    expect(s.run).toHaveBeenCalledWith(s.task.id, true);
  });
  it('closing the drawer does not cancel or pause a running transfer', async () => {
    const s = setup();
    const first = s.service.tasks.value[0];
    if (first) first.status = 'running';
    await nextTick();
    document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]')?.click();
    await nextTick();
    expect(s.service.open.value).toBe(false);
    expect(s.command).not.toHaveBeenCalled();
  });
  it('can return from cancellation confirmation without changing task state', async () => {
    const s = setup();
    await nextTick();
    button('取消后续传输').click();
    await flushPromises();
    button('取消').click();
    await flushPromises();
    expect(s.command).not.toHaveBeenCalled();
    expect(s.service.open.value).toBe(true);
  });
  it('refresh is an explicit recovery check, not a resume command', async () => {
    const s = setup();
    const refresh = vi.spyOn(s.service, 'refresh').mockResolvedValue();
    await nextTick();
    button('刷新').click();
    await flushPromises();
    expect(refresh).toHaveBeenCalledOnce();
    expect(s.run).not.toHaveBeenCalled();
  });
});
