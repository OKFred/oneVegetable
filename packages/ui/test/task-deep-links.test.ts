// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { defineComponent, h, ref } from 'vue';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GatewayException,
  type ProductMutationJob,
  type ProductMutationJobClient
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import type { VideoUploadControl, VideoUploadTask } from '@one-vegetable/core/video-upload';
import fixture from '../../../mock/data/video/upload.json';
import taskFixture from '../../../mock/data/video/upload-task.json';
import GalleryView from '../src/views/GalleryView.vue';
import ProductsView from '../src/views/ProductsView.vue';
import VideoUploadDialog from '../src/components/VideoUploadDialog.vue';
import ProductTaskCenter from '../src/components/ProductTaskCenter.vue';
import { provideServices, type AppServices } from '../src/lib/services';
import { GalleryTransferService, provideGalleryTransfers } from '../src/lib/gallery-transfer-service';
import { uiI18n } from '../src/i18n';
import { appHash } from '../src/lib/hash-router';
import * as batchQueue from '../src/lib/product-batch-publish';

vi.mock('vue-sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
const mounted: VueWrapper[] = [];
const clients: QueryClient[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function navigate(hash: string, event: 'hashchange' | 'popstate' = 'hashchange') {
  globalThis.history.replaceState(null, '', hash);
  globalThis.dispatchEvent(new Event(event));
  await flushPromises();
}
function uploadTask(id = 'upload-target'): VideoUploadTask {
  return { ...taskFixture, id, schemaVersion: 1, source: 'file', status: 'staged', title: id };
}
function setupVideo(options: { hash?: string; initialTaskId?: string; tasks?: VideoUploadTask[] } = {}) {
  globalThis.history.replaceState(null, '', options.hash ?? '#/photos/videos');
  const taskId = ref(options.initialTaskId);
  const gateway = new MockGatewayClient(0);
  const context = vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue(fixture.context);
  const call = vi.fn<VideoUploadControl['videoUpload']>().mockResolvedValue({
    tasks: options.tasks ?? [uploadTask()],
    uploadEnabled: true
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({
          gateway,
          mode: 'bff',
          videoUploads: { videoUpload: call },
          settings: { load: vi.fn(), save: vi.fn() }
        });
        return () =>
          options.initialTaskId === undefined
            ? h(GalleryView)
            : h(VideoUploadDialog, {
                open: true,
                ...(taskId.value === undefined ? {} : { initialTaskId: taskId.value })
              });
      }
    }),
    { attachTo: document.body, global: { stubs: { Photos: true } } }
  );
  mounted.push(wrapper);
  return { wrapper, taskId, call, context, body: new DOMWrapper(document.body) };
}
function job(
  id = 'job-target',
  operation: ProductMutationJob['operation'] = 'publishProduct'
): ProductMutationJob {
  return {
    id,
    requestId: `request-${id}`,
    productId: `product-${id}`,
    operation,
    status: 'verifying',
    categoryId: null,
    language: null,
    payloadFingerprint: 'a'.repeat(64),
    fieldExpectations: [],
    encryptedProductId: null,
    targetDisplay: null,
    originalDisplay: null,
    traceId: null,
    reasonCode: null,
    message: null,
    submittedTimeUtc: 1,
    lastCheckedTimeUtc: null,
    completedTimeUtc: null,
    createTimeUtc: 1,
    updateTimeUtc: 1,
    creatorId: 'user',
    updaterId: 'user',
    revision: 1,
    remark: null
  };
}
function setupProducts(
  hash = '#/products/tasks/job-target',
  jobs = [job()],
  listResult?: ReturnType<ProductMutationJobClient['list']>
) {
  globalThis.history.replaceState(null, '', hash);
  const gateway = new MockGatewayClient(0);
  const context = vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue(fixture.context);
  const request = vi.spyOn(gateway, 'request');
  const productMutationJobs = {
    list: vi
      .fn<ProductMutationJobClient['list']>()
      .mockReturnValue(
        listResult ?? Promise.resolve({ items: jobs, page: 1, pageSize: 100, total: jobs.length })
      ),
    get: vi.fn<ProductMutationJobClient['get']>().mockImplementation((id) => Promise.resolve(job(id))),
    refresh: vi
      .fn<ProductMutationJobClient['refresh']>()
      .mockImplementation((id) => Promise.resolve(job(id))),
    recover: vi.fn<ProductMutationJobClient['recover']>().mockImplementation((id) => Promise.resolve(job(id)))
  };
  const availability = vi.fn().mockResolvedValue({ items: [] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const services: AppServices = {
    gateway,
    mode: 'mock',
    productMutationJobs,
    operationAvailability: { get: availability },
    settings: { load: vi.fn(), save: vi.fn() }
  };
  const gallery = new GalleryTransferService(services);
  clients.push(queryClient);
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices(services);
        provideGalleryTransfers(gallery);
        return () => h(ProductsView);
      }
    }),
    { attachTo: document.body, global: { plugins: [[VueQueryPlugin, { queryClient }]] } }
  );
  mounted.push(wrapper);
  return { wrapper, context, request, availability, gallery, ...productMutationJobs };
}

beforeEach(() => {
  localStorage.clear();
  uiI18n.global.locale.value = 'zh-CN';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  document.body.innerHTML = '';
  globalThis.history.replaceState(null, '', '#/dashboard');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('video upload deep links', () => {
  it('uses GalleryView routing, selects exactly the requested record and restores the video route on close', async () => {
    const s = setupVideo({
      hash: '#/photos/videos/uploads/upload-target',
      tasks: [uploadTask('other'), uploadTask()]
    });
    await vi.waitFor(() => {
      expect(s.body.find('[data-testid="video-upload-task-select"]').exists()).toBe(true);
    });
    expect(s.body.get<HTMLSelectElement>('[data-testid="video-upload-task-select"]').element.value).toBe(
      'upload-target'
    );
    expect(s.wrapper.get('a[href="#/photos/videos"]').attributes('aria-current')).toBe('page');
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['list']);
    (s.wrapper.getComponent(VideoUploadDialog) as Pick<VueWrapper, 'vm'>).vm.$emit('update:open', false);
    await flushPromises();
    expect(globalThis.location.hash).toBe('#/photos/videos');
    expect(s.wrapper.findComponent(VideoUploadDialog).exists()).toBe(false);
  });

  it('supports initialTaskId and exact get when the requested upload is absent from list', async () => {
    const s = setupVideo({ initialTaskId: 'upload-target', tasks: [uploadTask('other')] });
    s.call.mockImplementation((command) =>
      Promise.resolve({
        tasks: [uploadTask(command.action === 'get' ? 'upload-target' : 'other')],
        uploadEnabled: true
      })
    );
    await flushPromises();
    expect(s.call.mock.calls.map(([command]) => command)).toEqual([
      { action: 'list' },
      { action: 'get', taskId: 'upload-target' }
    ]);
    expect(s.body.get<HTMLSelectElement>('[data-testid="video-upload-task-select"]').element.value).toBe(
      'upload-target'
    );
  });

  it.each(['missing', 'denied', 'wrong-account'] as const)(
    'does not select another upload on %s',
    async (kind) => {
      const s = setupVideo({ initialTaskId: 'upload-target', tasks: [uploadTask('other')] });
      s.call.mockImplementation((command) => {
        if (command.action === 'get' && kind === 'denied')
          return Promise.reject(
            new GatewayException({ code: 'FORBIDDEN', message: 'Denied', retryable: false })
          );
        const target =
          kind === 'wrong-account'
            ? { ...uploadTask(), context: { ...fixture.context, identity: 'other-account' } }
            : uploadTask('other');
        return Promise.resolve({ tasks: [target], uploadEnabled: true });
      });
      await flushPromises();
      expect(s.body.find('[data-testid="video-upload-task-select"]').exists()).toBe(false);
      expect(s.body.find('dl').exists()).toBe(false);
      expect(s.body.find('[role="alert"]').exists()).toBe(true);
      expect(
        s.call.mock.calls.every(([command]) => command.action === 'list' || command.action === 'get')
      ).toBe(true);
    }
  );

  it.each(['switch', 'denied'] as const)('clears a selected upload when focus detects %s', async (kind) => {
    const s = setupVideo({ initialTaskId: 'upload-target' });
    await flushPromises();
    expect(s.body.find('dl').exists()).toBe(true);
    if (kind === 'switch') s.context.mockResolvedValue({ ...fixture.context, identity: 'new-account' });
    else s.context.mockRejectedValue(new Error('FORBIDDEN'));
    globalThis.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(s.body.find('dl').exists()).toBe(false);
    expect(s.body.find('[data-testid="video-upload-task-select"]').exists()).toBe(false);
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['list']);
  });

  it('rejects an account switch while a list read is in flight', async () => {
    const pending = deferred<{ tasks: VideoUploadTask[]; uploadEnabled: boolean }>();
    const s = setupVideo({ initialTaskId: 'upload-target' });
    s.call.mockReturnValue(pending.promise);
    await flushPromises();
    s.context.mockResolvedValue({ ...fixture.context, gateway: 'changed' });
    pending.resolve({ tasks: [uploadTask()], uploadEnabled: true });
    await flushPromises();
    expect(s.body.find('dl').exists()).toBe(false);
    expect(s.body.text()).toContain('GALLERY_TASK_CONTEXT_CHANGED');
  });

  it('does not let an older task request replace a newer initialTaskId', async () => {
    const pending = deferred<{ tasks: VideoUploadTask[]; uploadEnabled: boolean }>();
    const s = setupVideo({ initialTaskId: 'upload-target' });
    s.call.mockReturnValueOnce(pending.promise);
    await flushPromises();
    s.call.mockResolvedValue({ tasks: [uploadTask('next')], uploadEnabled: true });
    s.taskId.value = 'next';
    await flushPromises();
    pending.resolve({ tasks: [uploadTask()], uploadEnabled: true });
    await flushPromises();
    expect(s.body.get<HTMLSelectElement>('[data-testid="video-upload-task-select"]').element.value).toBe(
      'next'
    );
    expect(s.body.get('dl').text()).not.toContain('upload-target');
  });

  it('handles hashchange/popstate, decoded IDs, and never intercepts a photo task route', async () => {
    const id = 'upload / encoded';
    const s = setupVideo({ tasks: [uploadTask(id)] });
    await vi.waitFor(() => {
      expect(s.wrapper.find('[data-testid="video-library"]').exists()).toBe(true);
    });
    expect(s.wrapper.findComponent(VideoUploadDialog).exists()).toBe(false);
    await navigate(appHash('photos', 'videos', 'uploads', id), 'popstate');
    await vi.waitFor(() => {
      expect(s.body.find('dl').exists()).toBe(true);
    });
    expect(s.body.get<HTMLSelectElement>('[data-testid="video-upload-task-select"]').element.value).toBe(id);
    await navigate('#/photos/videos');
    expect(s.wrapper.findComponent(VideoUploadDialog).exists()).toBe(false);
    await navigate('#/photos/tasks/photo-task');
    expect(s.wrapper.find('[data-testid="video-library"]').exists()).toBe(false);
    expect(globalThis.location.hash).toBe('#/photos/tasks/photo-task');
  });
});

describe('product job deep links', () => {
  it('gets a job outside the latest 100 and highlights only that exact record without auto-refresh/recovery', async () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      job(`recent-${i}`, i % 2 ? 'publishProduct' : 'updateProductDisplay')
    );
    const s = setupProducts('#/products/tasks/job-target', rows);
    await flushPromises();
    const center = s.wrapper.getComponent(ProductTaskCenter);
    expect(s.list).toHaveBeenCalledWith({ pageSize: 100 });
    expect(s.get).toHaveBeenCalledExactlyOnceWith('job-target');
    expect(center.get('[data-testid="product-task-target"]').text()).toContain('job-target');
    expect(center.get('tbody tr.bg-accent').text()).toContain('product-job-target');
    expect(center.text()).not.toContain('product-recent-');
    expect(document.activeElement).toBe(center.get('[data-testid="product-task-target"]').element);
    expect(s.refresh).not.toHaveBeenCalled();
    expect(s.recover).not.toHaveBeenCalled();
    expect(
      s.request.mock.calls.some(([operation]) =>
        ['publishProduct', 'updateProduct', 'updateProductDisplay', 'saveProductDraft'].includes(operation)
      )
    ).toBe(false);
    await center.get('[data-testid="product-task-target"] button').trigger('click');
    await flushPromises();
    expect(globalThis.location.hash).toBe('#/products/tasks');
    expect(center.find('[data-testid="product-task-target"]').exists()).toBe(false);
    expect(center.text()).toContain('product-recent-0');
  });

  it.each(['missing', 'denied', 'wrong-id'] as const)(
    'never falls back to another product job on %s',
    async (kind) => {
      const s = setupProducts('#/products/tasks/job-target', [job('other')]);
      if (kind === 'wrong-id') s.get.mockResolvedValue(job('other'));
      else
        s.get.mockRejectedValue(
          new GatewayException({
            code: kind === 'denied' ? 'FORBIDDEN' : 'NOT_FOUND',
            message: kind,
            retryable: false
          })
        );
      await flushPromises();
      const center = s.wrapper.getComponent(ProductTaskCenter);
      expect(center.props('jobs')).toEqual([]);
      expect(center.props('error')).toBeTruthy();
      expect(center.find('tbody tr.bg-accent').exists()).toBe(false);
      expect(center.text()).not.toContain('product-other');
      expect(s.refresh).not.toHaveBeenCalled();
      expect(s.recover).not.toHaveBeenCalled();
    }
  );

  it.each(['switch', 'denied'] as const)(
    'invalidates the job and all actions on account %s',
    async (kind) => {
      const s = setupProducts();
      await flushPromises();
      if (kind === 'switch') s.context.mockResolvedValue({ ...fixture.context, identity: 'new-account' });
      else s.context.mockRejectedValue(new Error('FORBIDDEN'));
      globalThis.dispatchEvent(new Event('focus'));
      await flushPromises();
      const center = s.wrapper.getComponent(ProductTaskCenter);
      expect(center.props('jobs')).toEqual([]);
      expect(center.props('error')).toBeTruthy();
      (center as Pick<VueWrapper, 'vm'>).vm.$emit('refresh');
      await flushPromises();
      expect(s.get).toHaveBeenCalledTimes(1);
      expect(s.refresh).not.toHaveBeenCalled();
    }
  );

  it('discards an exact read completed after an account change', async () => {
    const pending = deferred<ProductMutationJob>();
    const s = setupProducts();
    s.get.mockReturnValue(pending.promise);
    await flushPromises();
    s.context.mockResolvedValue({ ...fixture.context, identity: 'new-account' });
    pending.resolve(job());
    await flushPromises();
    expect(s.wrapper.getComponent(ProductTaskCenter).props('jobs')).toEqual([]);
    expect(s.wrapper.getComponent(ProductTaskCenter).props('error')).toBeTruthy();
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('discards older exact reads on rapid hash changes and decodes the new ID on popstate', async () => {
    const pending = deferred<ProductMutationJob>();
    const s = setupProducts();
    s.get.mockReturnValueOnce(pending.promise);
    await flushPromises();
    const id = 'job / encoded';
    await navigate(appHash('products', 'tasks', id), 'popstate');
    expect(s.get).toHaveBeenLastCalledWith(id);
    pending.resolve(job());
    await flushPromises();
    const center = s.wrapper.getComponent(ProductTaskCenter);
    expect(center.get('[data-testid="product-task-target"]').text()).toContain(id);
    expect(center.get('tbody tr.bg-accent').text()).toContain(`product-${id}`);
    expect(center.text()).not.toContain('product-job-target');
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('does not auto-refresh a list request that started before navigation to a job', async () => {
    const pending = deferred<Awaited<ReturnType<ProductMutationJobClient['list']>>>();
    const s = setupProducts('#/products/list', [], pending.promise);
    await flushPromises();
    await navigate('#/products/tasks/job-target');
    pending.resolve({
      items: [job(), job('display', 'updateProductDisplay')],
      page: 1,
      pageSize: 100,
      total: 2
    });
    await flushPromises();
    expect(s.refresh).not.toHaveBeenCalled();
    expect(s.recover).not.toHaveBeenCalled();
    expect(s.wrapper.getComponent(ProductTaskCenter).props('jobId')).toBe('job-target');
  });
});

describe('read-only product history deep links', () => {
  it('accepts first same-account context initialization and still blocks a later real account switch', async () => {
    const s = setupProducts('#/products/tasks/job-target/history');
    await flushPromises();
    s.gallery.currentContext.value = fixture.context;
    await flushPromises();
    const center = s.wrapper.getComponent(ProductTaskCenter);
    expect(center.props('error')).toBeNull();
    expect(center.get('tbody tr.bg-accent').text()).toContain('product-job-target');
    (center as Pick<VueWrapper, 'vm'>).vm.$emit('refresh');
    await flushPromises();
    expect(s.get).toHaveBeenCalledTimes(2);
    expect(center.props('error')).toBeNull();
    s.gallery.currentContext.value = { ...fixture.context, identity: 'different-account' };
    await flushPromises();
    expect(center.props('jobs')).toEqual([]);
    expect(center.props('error')).toBeTruthy();
    (center as Pick<VueWrapper, 'vm'>).vm.$emit('refresh');
    await flushPromises();
    expect(s.get).toHaveBeenCalledTimes(2);
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('only reads durable list/get records on entry, focus and explicit list reload', async () => {
    const s = setupProducts('#/products/tasks/job-target/history', [job('other', 'updateProductDisplay')]);
    s.get.mockResolvedValue({ ...job('job-target', 'updateProductDisplay'), status: 'recovery-required' });
    await flushPromises();
    const center = s.wrapper.getComponent(ProductTaskCenter);
    expect(center.props('readOnly')).toBe(true);
    expect(center.props('jobId')).toBe('job-target');
    expect(center.get('[data-testid="product-task-history-notice"]').text()).toContain(
      '未保存 Alibaba 账号指纹'
    );
    expect(center.get('tbody tr.bg-accent').text()).toContain('product-job-target');
    expect(s.request).not.toHaveBeenCalled();
    expect(s.availability).not.toHaveBeenCalled();
    expect(s.list).toHaveBeenCalledTimes(1);
    expect(s.get).toHaveBeenCalledExactlyOnceWith('job-target');
    globalThis.dispatchEvent(new Event('focus'));
    await flushPromises();
    (center as Pick<VueWrapper, 'vm'>).vm.$emit('refresh');
    await flushPromises();
    expect(s.list).toHaveBeenCalledTimes(2);
    expect(s.get).toHaveBeenCalledTimes(2);
    expect(s.request).not.toHaveBeenCalled();
    expect(s.availability).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
    expect(s.recover).not.toHaveBeenCalled();
    await center.get('[data-testid="product-task-target"] button').trigger('click');
    expect(globalThis.location.hash).toBe('#/tasks');
    expect(s.request).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('guards refresh/recovery handlers even if an event bypasses the read-only UI', async () => {
    const s = setupProducts('#/products/tasks/job-target/history');
    await flushPromises();
    const center = s.wrapper.getComponent(ProductTaskCenter);
    (center as Pick<VueWrapper, 'vm'>).vm.$emit('refresh-job', job());
    (center as Pick<VueWrapper, 'vm'>).vm.$emit('recover', {
      ...job('job-target', 'updateProductDisplay'),
      status: 'recovery-required'
    });
    await flushPromises();
    expect(s.refresh).not.toHaveBeenCalled();
    expect(s.recover).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('确认恢复商品状态');
  });

  it('hides platform actions for every displayed history job, keeps copying and restores ordinary actions', async () => {
    const jobs = [
      job(),
      { ...job('recovery', 'updateProductDisplay'), status: 'recovery-required' as const }
    ];
    const wrapper = mount(ProductTaskCenter, {
      props: {
        jobs,
        readOnly: true,
        batchItems: [],
        loading: false,
        error: null,
        refreshingJobId: '',
        detailUrls: {}
      },
      global: { stubs: { RowActionsMenu: { template: '<div><slot /></div>' } } }
    });
    mounted.push(wrapper as VueWrapper);
    expect(wrapper.findAll('button').some((button) => button.text() === '查询平台状态')).toBe(false);
    expect(wrapper.findAll('button').some((button) => button.text() === '恢复原状态')).toBe(false);
    expect(wrapper.findAll('button').filter((button) => button.text() === '复制标识')).toHaveLength(2);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(globalThis.navigator) as Navigator, { clipboard: { writeText } })
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '复制标识')
      ?.trigger('click');
    expect(writeText).toHaveBeenCalledWith('request-job-target');
    expect(wrapper.emitted('refresh-job')).toBeUndefined();
    expect(wrapper.emitted('recover')).toBeUndefined();
    await wrapper.setProps({ readOnly: false });
    expect(wrapper.text()).toContain('查询平台状态');
    expect(wrapper.text()).toContain('恢复原状态');
  });

  it('discards stale history on permission denial after a successful read', async () => {
    const s = setupProducts('#/products/tasks/job-target/history');
    await flushPromises();
    s.get.mockRejectedValue(new GatewayException({ code: 'FORBIDDEN', message: 'Denied', retryable: false }));
    (s.wrapper.getComponent(ProductTaskCenter) as Pick<VueWrapper, 'vm'>).vm.$emit('refresh');
    await flushPromises();
    const center = s.wrapper.getComponent(ProductTaskCenter);
    expect(center.props('jobs')).toEqual([]);
    expect(center.props('error')).toBeTruthy();
    expect(center.find('tbody tr.bg-accent').exists()).toBe(false);
    expect(s.request).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
    expect(s.recover).not.toHaveBeenCalled();
  });

  it('does not schedule platform readback or other business queries while history stays open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const s = setupProducts('#/products/tasks/job-target/history', [
      job(),
      job('display', 'updateProductDisplay')
    ]);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(45_000);
    await flushPromises();
    expect(s.list).toHaveBeenCalledTimes(1);
    expect(s.get).toHaveBeenCalledExactlyOnceWith('job-target');
    expect(s.refresh).not.toHaveBeenCalled();
    expect(s.recover).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
    expect(s.availability).not.toHaveBeenCalled();
  });

  it('never loads, migrates, recovers or reconciles local batch queues in history', async () => {
    localStorage.setItem('one-vegetable-product-batch-publish-v1', 'legacy-keep-unchanged');
    localStorage.setItem(batchQueue.PRODUCT_BATCH_PUBLISH_STORAGE_KEY, 'corrupt-keep-unchanged');
    const load = vi.spyOn(batchQueue, 'loadProductBatchPublishItems');
    const recover = vi.spyOn(batchQueue, 'recoverInterruptedProductBatchPublishItems');
    const reconcile = vi.spyOn(batchQueue, 'reconcileProductBatchPublishJobs');
    const s = setupProducts('#/products/tasks/job-target/history');
    await flushPromises();
    (s.wrapper.getComponent(ProductTaskCenter) as Pick<VueWrapper, 'vm'>).vm.$emit('refresh');
    await flushPromises();
    expect(load).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(localStorage.getItem('one-vegetable-product-batch-publish-v1')).toBe('legacy-keep-unchanged');
    expect(localStorage.getItem(batchQueue.PRODUCT_BATCH_PUBLISH_STORAGE_KEY)).toBe('corrupt-keep-unchanged');
  });

  it('does not refresh pending ordinary-page jobs after navigation enters history', async () => {
    const pending = deferred<Awaited<ReturnType<ProductMutationJobClient['list']>>>();
    const s = setupProducts('#/products/list', [], pending.promise);
    await flushPromises();
    await navigate('#/products/tasks/job-target/history');
    s.request.mockClear();
    s.availability.mockClear();
    pending.resolve({
      items: [job(), job('display', 'updateProductDisplay')],
      page: 1,
      pageSize: 100,
      total: 2
    });
    await flushPromises();
    expect(s.wrapper.getComponent(ProductTaskCenter).props('readOnly')).toBe(true);
    expect(s.wrapper.getComponent(ProductTaskCenter).props('jobId')).toBe('job-target');
    expect(s.refresh).not.toHaveBeenCalled();
    expect(s.recover).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
    expect(s.availability).not.toHaveBeenCalled();
  });
});

describe('automatic product readback lifetime', () => {
  it.each(['unmount', 'route', 'account'] as const)(
    'does not refresh display/creation/product jobs after pending lists outlive %s',
    async (boundary) => {
      const pending = deferred<Awaited<ReturnType<ProductMutationJobClient['list']>>>();
      const s = setupProducts('#/products/publisher/quick/basics/10000001/100009999', [], pending.promise);
      await vi.waitFor(() => {
        expect(s.list).toHaveBeenCalledWith({ productId: '10000001', pageSize: 20 });
        expect(s.list).toHaveBeenCalledWith({ pageSize: 100 });
      });
      if (boundary === 'unmount') {
        mounted.splice(mounted.indexOf(s.wrapper), 1);
        s.wrapper.unmount();
      } else if (boundary === 'route') {
        await navigate('#/dashboard');
      } else {
        // Detect the live gateway identity change even without a reactive context/focus event.
        s.context.mockResolvedValue({ ...fixture.context, identity: 'different-account' });
      }
      pending.resolve({
        items: [
          job(),
          job('display', 'updateProductDisplay'),
          { ...job('update', 'updateProduct'), status: 'auditing' }
        ],
        page: 1,
        pageSize: 100,
        total: 3
      });
      await flushPromises();
      expect(s.refresh).not.toHaveBeenCalled();
      expect(s.recover).not.toHaveBeenCalled();
    }
  );

  it('does not continue automatic refresh loops after a sent refresh completes following unmount', async () => {
    const pending = deferred<ProductMutationJob>();
    const s = setupProducts('#/products/list', [
      job('one'),
      job('two'),
      job('display-one', 'updateProductDisplay'),
      job('display-two', 'updateProductDisplay')
    ]);
    s.refresh.mockReturnValue(pending.promise);
    await vi.waitFor(() => {
      expect(s.refresh).toHaveBeenCalledTimes(2);
    });
    mounted.splice(mounted.indexOf(s.wrapper), 1);
    s.wrapper.unmount();
    pending.resolve(job());
    await flushPromises();
    expect(s.refresh).toHaveBeenCalledTimes(2);
  });
});
