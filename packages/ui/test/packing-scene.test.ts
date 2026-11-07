// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  InstancedMesh,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type Camera,
  type Object3D,
  type Scene
} from 'three';
import type * as Three from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import PackingScene from '../src/components/PackingScene.vue';
import { translateUi } from '../src/i18n';
import { PACKING_COLORS } from '../src/lib/packing-colors';
import type { PackingInput, PackingResult } from '../src/lib/packing-layout';

const gpu = vi.hoisted(() => ({
  construct: vi.fn(),
  render: vi.fn<(scene: Scene, camera: Camera) => void>(),
  setSize: vi.fn(),
  setPixelRatio: vi.fn(),
  dispose: vi.fn(),
  forceContextLoss: vi.fn()
}));

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof Three>();
  return {
    ...three,
    WebGLRenderer: class {
      constructor() {
        gpu.construct();
      }
      render = gpu.render;
      setSize = gpu.setSize;
      setPixelRatio = gpu.setPixelRatio;
      dispose = gpu.dispose;
      forceContextLoss = gpu.forceContextLoss;
    }
  };
});

const sizeA = { length: 200, width: 100, height: 100 };
const sizeB = { length: 100, width: 100, height: 100 };
const input: PackingInput = {
  container: { length: 1000, width: 800, height: 600 },
  cargo: [
    { id: 'a', name: 'A', size: sizeA, quantity: 2, allowRotation: false },
    { id: 'b', name: 'B', size: sizeB, quantity: 1, allowRotation: false }
  ]
};
const result: PackingResult = {
  placements: [
    { cargoId: 'a', index: 0, x: 100, y: 200, z: 0, size: sizeA },
    { cargoId: 'a', index: 1, x: 100, y: 200, z: 100, size: sizeA },
    { cargoId: 'b', index: 0, x: 600, y: 100, z: 0, size: sizeB }
  ],
  unplaced: [],
  totalCount: 3,
  packedCount: 3,
  containerVolume: 480_000_000,
  usedVolume: 5_000_000
};
const props = { input, result, selectedCargoId: null, view: 'perspective' as const, resetKey: 0 };
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let resizeCallback: ResizeObserverCallback;
const disconnectResize = vi.fn();
const unmounts: (() => void)[] = [];

function renderScene(view: 'perspective' | 'top' | 'front' | 'side' = 'perspective') {
  const wrapper = mount(PackingScene, { props: { ...props, view }, attachTo: document.body });
  const canvas = wrapper.get('canvas').element;
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  unmounts.push(() => {
    wrapper.unmount();
  });
  return wrapper;
}

async function draw(): Promise<void> {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
  await nextTick();
}

function isCargoMesh(object: Object3D): object is InstancedMesh<BoxGeometry, MeshLambertMaterial> {
  return (
    object instanceof InstancedMesh &&
    object.geometry instanceof BoxGeometry &&
    object.material instanceof MeshLambertMaterial
  );
}

function isRenderable(object: Object3D): object is Mesh | LineSegments {
  return object instanceof Mesh || object instanceof LineSegments;
}

function rendered() {
  const call = gpu.render.mock.lastCall;
  if (!call) throw new Error('Scene has not rendered');
  const [scene, camera] = call;
  const meshes: InstancedMesh<BoxGeometry, MeshLambertMaterial>[] = [];
  scene.traverse((object) => {
    if (isCargoMesh(object)) meshes.push(object);
  });
  const [first, second] = meshes;
  if (!first || !second) throw new Error('Expected both cargo types');
  return { scene, camera, meshes, first, second };
}

function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
    isPrimary: { value: true }
  });
  canvas.dispatchEvent(event);
}

describe('PackingScene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frames.clear();
    document.documentElement.classList.remove('dark');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(440);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 440,
      width: 800,
      height: 440,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.set(++frameId, callback);
        return frameId;
      })
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frames.delete(id))
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = vi.fn();
        disconnect = disconnectResize;
      }
    );
    gpu.render.mockImplementation((scene, camera) => {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
    });
  });

  afterEach(() => {
    for (const unmount of unmounts.splice(0)) unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark');
  });

  it('shows a translated fallback without throwing when WebGL2 is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const wrapper = renderScene();
    await nextTick();
    expect(wrapper.attributes('data-status')).toBe('unavailable');
    expect(wrapper.attributes('data-render-count')).toBe('0');
    expect(wrapper.get('[role="status"]').text()).toBe(translateUi('logistics.packing.threeUnavailable'));
    expect(wrapper.get('canvas').isVisible()).toBe(false);
    expect(gpu.construct).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('handles renderer construction and rendering failures without leaving work scheduled', async () => {
    gpu.construct.mockImplementationOnce(() => {
      throw new Error('GPU unavailable');
    });
    const first = renderScene();
    await nextTick();
    expect(first.attributes('data-status')).toBe('unavailable');
    expect(frames.size).toBe(0);
    gpu.render.mockImplementationOnce(() => {
      throw new Error('GPU draw failed');
    });
    const second = renderScene();
    await draw();
    expect(second.attributes('data-status')).toBe('unavailable');
    expect(second.attributes('data-render-count')).toBe('0');
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('uses real per-type instances, mm-to-Y-up coordinates, accessible canvas and demand-only rendering', async () => {
    const wrapper = renderScene();
    expect(gpu.render).not.toHaveBeenCalled();
    await draw();
    expect(wrapper.attributes('data-status')).toBe('ready');
    expect(wrapper.attributes('data-render-count')).toBe('1');
    expect(wrapper.get('canvas').attributes('role')).toBe('img');
    expect(wrapper.get('canvas').attributes('aria-label')).toBe(translateUi('logistics.packing.sceneLabel'));
    expect(wrapper.get('canvas').attributes('tabindex')).toBeUndefined();
    const { meshes, first } = rendered();
    expect(meshes.map((mesh) => mesh.count)).toEqual([2, 1]);
    expect(meshes.map((mesh) => '#' + mesh.material.color.getHexString())).toEqual(
      PACKING_COLORS.slice(0, 2)
    );
    const matrix = new Matrix4();
    first.getMatrixAt(1, matrix);
    const center = new Vector3().setFromMatrixPosition(matrix);
    expect(center.x).toBeCloseTo(0.2);
    expect(center.y).toBeCloseTo(0.15);
    expect(center.z).toBeCloseTo(-0.25);
    await draw();
    expect(gpu.render).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('frames each view, resets the camera and resizes through the observer', async () => {
    const wrapper = renderScene();
    await draw();
    const { camera } = rendered();
    const original = camera.position.clone();
    for (const view of ['top', 'front', 'side'] as const) {
      await wrapper.setProps({ view });
      await draw();
      const direction = camera.position
        .clone()
        .sub(new Vector3(0.5, 0.3, -0.4))
        .normalize();
      expect(direction.getComponent(view === 'top' ? 1 : view === 'front' ? 2 : 0)).toBeCloseTo(1);
    }
    await wrapper.setProps({ view: 'perspective' });
    await draw();
    expect(camera.position.distanceTo(original)).toBeCloseTo(0);
    camera.position.set(8, 9, 10);
    await wrapper.setProps({ resetKey: 1 });
    await draw();
    expect(camera.position.distanceTo(original)).toBeCloseTo(0);
    resizeCallback([], {} as ResizeObserver);
    await draw();
    expect(gpu.setSize).toHaveBeenLastCalledWith(800, 440, false);
    expect(frames.size).toBe(0);
  });

  it('raycasts a clicked instance to its type but ignores a drag even when it returns to the start', async () => {
    const wrapper = renderScene('front');
    await draw();
    const { camera } = rendered();
    const projected = new Vector3(0.2, 0.05, -0.25).project(camera);
    const x = (projected.x + 1) * 400;
    const y = (1 - projected.y) * 220;
    const element = wrapper.get('canvas').element;
    pointer(element, 'pointerdown', x, y);
    pointer(element, 'pointermove', x + 30, y);
    pointer(element, 'pointermove', x, y);
    pointer(element, 'pointerup', x, y);
    expect(wrapper.emitted('select')).toBeUndefined();
    pointer(element, 'pointerdown', x, y);
    pointer(element, 'pointerup', x, y);
    expect(wrapper.emitted('select')).toEqual([['a']]);
    pointer(element, 'pointerdown', 1, 1);
    pointer(element, 'pointerup', 1, 1);
    expect(wrapper.emitted('select')?.at(-1)).toEqual([null]);
  });

  it('highlights the selected type, keeps other boxes visible and follows live theme changes', async () => {
    const wrapper = renderScene();
    await draw();
    const { scene, first, second } = rendered();
    const original = second.material.color.clone();
    await wrapper.setProps({ selectedCargoId: 'a' });
    await draw();
    expect(wrapper.attributes('data-selected-cargo')).toBe('a');
    expect(wrapper.attributes('data-selected-type')).toBe('0');
    expect(first.material.emissiveIntensity).toBeGreaterThan(0);
    expect(second.material.color.equals(original)).toBe(false);
    expect(second.visible).toBe(true);
    expect(second.material.opacity).toBe(1);
    document.documentElement.classList.add('dark');
    await nextTick();
    await draw();
    expect(scene.background instanceof Color && scene.background.getHexString()).toBe('0b1220');
    await wrapper.setProps({ selectedCargoId: null });
    await draw();
    expect(second.material.color.equals(original)).toBe(true);
    expect(frames.size).toBe(0);
  });

  it('releases every scene resource, controls, observers, DOM listeners and pending frame on unmount', async () => {
    const controlsDispose = vi.spyOn(OrbitControls.prototype, 'dispose');
    const themeDisconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const wrapper = renderScene();
    await draw();
    const { scene, meshes } = rendered();
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    scene.traverse((object) => {
      if (isRenderable(object)) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
      }
    });
    const disposals = [...geometries, ...materials, ...meshes].map((resource) =>
      vi.spyOn(resource, 'dispose')
    );
    const canvas = wrapper.get('canvas').element;
    const removeListener = vi.spyOn(canvas, 'removeEventListener');
    await wrapper.setProps({ selectedCargoId: 'a' });
    expect(frames.size).toBe(1);
    unmounts.pop()?.();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
    expect(controlsDispose).toHaveBeenCalledTimes(1);
    expect(themeDisconnect).toHaveBeenCalledTimes(1);
    expect(disconnectResize).toHaveBeenCalledTimes(1);
    expect(removeListener.mock.calls.some(([type]) => type === 'wheel')).toBe(true);
    expect(removeListener.mock.calls.some(([type]) => type === 'pointerdown')).toBe(true);
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(gpu.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    document.documentElement.classList.add('dark');
    resizeCallback([], {} as ResizeObserver);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    await nextTick();
    expect(frames.size).toBe(0);
  });

  it('replaces a lost context with a translated status and does not double-dispose on unmount', async () => {
    const wrapper = renderScene();
    await draw();
    const event = new Event('webglcontextlost', { cancelable: true });
    wrapper.get('canvas').element.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.attributes('data-status')).toBe('context-lost');
    expect(wrapper.get('[role="status"]').text()).toBe(translateUi('logistics.packing.threeUnavailable'));
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    unmounts.pop()?.();
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
});
