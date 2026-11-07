<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  GridHelper,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { useUiI18n } from '../i18n';
import { PACKING_COLORS } from '../lib/packing-colors';
import type { PackingInput, PackingResult } from '../lib/packing-layout';

const props = defineProps<{
  input: PackingInput;
  result: PackingResult;
  selectedCargoId: string | null;
  view: 'perspective' | 'top' | 'front' | 'side';
  resetKey: number;
}>();
const emit = defineEmits<{ select: [cargoId: string | null] }>();
const { t } = useUiI18n();
const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const status = ref<'initializing' | 'ready' | 'unavailable' | 'context-lost'>('initializing');
const renderCount = ref(0);
const selectedType = computed(() =>
  props.selectedCargoId === null
    ? ''
    : props.input.cargo.findIndex((cargo) => cargo.id === props.selectedCargoId)
);
const scene = new Scene();
const model = new Group();
const camera = new PerspectiveCamera(40, 1, 0.001, 100);
const raycaster = new Raycaster();
const cargoMeshes = new Map<InstancedMesh<BoxGeometry, MeshLambertMaterial>, { id: string; color: string }>();
let renderer: WebGLRenderer | undefined;
let controls: OrbitControls | undefined;
let resizeObserver: ResizeObserver | undefined;
let themeObserver: MutationObserver | undefined;
let floor: GridHelper | undefined;
let wire: LineSegments<EdgesGeometry, LineBasicMaterial> | undefined;
let frame: number | undefined;
let disposed = false;
let pointer: { id: number; x: number; y: number; moved: boolean } | undefined;

function requestRender(): void {
  if (!renderer || disposed || frame !== undefined) return;
  frame = globalThis.requestAnimationFrame(() => {
    frame = undefined;
    if (!renderer || disposed) return;
    try {
      renderer.render(scene, camera);
      renderCount.value++;
      status.value = 'ready';
    } catch {
      fail('unavailable');
    }
  });
}

function clearModel(): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  model.traverse((object) => {
    if (object instanceof InstancedMesh) object.dispose();
    if (object instanceof Mesh || object instanceof LineSegments) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  model.clear();
  cargoMeshes.clear();
  floor = undefined;
  wire = undefined;
}

function release(): void {
  const activeRenderer = renderer;
  renderer = undefined;
  if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
  frame = undefined;
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
  controls?.removeEventListener('change', requestRender);
  controls?.dispose();
  controls = undefined;
  clearModel();
  scene.clear();
  activeRenderer?.dispose();
  activeRenderer?.forceContextLoss();
  pointer = undefined;
}

function fail(reason: 'unavailable' | 'context-lost'): void {
  status.value = reason;
  release();
}

function contextLost(event: Event): void {
  event.preventDefault();
  if (!disposed && renderer) fail('context-lost');
}

function updateSelection(): void {
  const background = scene.background instanceof Color ? scene.background : new Color('#f8fafc');
  for (const [mesh, cargo] of cargoMeshes) {
    const selected = props.selectedCargoId === cargo.id;
    mesh.material.color.set(cargo.color);
    if (props.selectedCargoId !== null && !selected) mesh.material.color.lerp(background, 0.65);
    mesh.material.emissive.set(selected ? cargo.color : '#000000');
    mesh.material.emissiveIntensity = selected ? 0.25 : 0;
  }
  requestRender();
}

function updateTheme(): void {
  const dark = globalThis.document.documentElement.classList.contains('dark');
  scene.background = new Color(dark ? '#0b1220' : '#f8fafc');
  wire?.material.color.set(dark ? '#cbd5e1' : '#334155');
  floor?.material.color.set(dark ? '#334155' : '#cbd5e1');
  updateSelection();
}

function fitCamera(): void {
  if (!controls) return;
  const { length, width, height } = props.input.container;
  const unit = 1 / Math.max(length, width, height, 1);
  const radius = (Math.hypot(length, width, height) * unit) / 2;
  const vertical = (camera.fov * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.12;
  const direction = new Vector3();
  if (props.view === 'top') direction.set(0, 1, 0.000001);
  else if (props.view === 'front') direction.set(0, 0, 1);
  else if (props.view === 'side') direction.set(1, 0, 0);
  else direction.set(1, 0.8, 1);
  controls.target.set((length * unit) / 2, (height * unit) / 2, (-width * unit) / 2);
  camera.position.copy(controls.target).addScaledVector(direction.normalize(), distance);
  camera.near = Math.max(radius / 1000, 0.00001);
  camera.far = Math.max(radius * 100, 10);
  camera.updateProjectionMatrix();
  controls.minDistance = radius * 0.1;
  controls.maxDistance = radius * 30;
  controls.enableRotate = props.view === 'perspective';
  controls.update();
  camera.updateMatrixWorld();
  requestRender();
}

function rebuild(): void {
  if (!renderer) return;
  clearModel();
  const { length, width, height } = props.input.container;
  const unit = 1 / Math.max(length, width, height, 1);
  const containerGeometry = new BoxGeometry(length * unit, height * unit, width * unit);
  wire = new LineSegments(new EdgesGeometry(containerGeometry), new LineBasicMaterial());
  containerGeometry.dispose();
  wire.position.set((length * unit) / 2, (height * unit) / 2, (-width * unit) / 2);
  model.add(wire);
  floor = new GridHelper(1, 10, '#ffffff', '#ffffff');
  floor.scale.set(length * unit, 1, width * unit);
  floor.position.set((length * unit) / 2, -0.002, (-width * unit) / 2);
  model.add(floor);

  // Packing Z-up maps to Three Y-up as (x, z, -y), preserving a right-handed frame.
  const axes = new BufferGeometry().setFromPoints([
    new Vector3(),
    new Vector3(0.15, 0, 0),
    new Vector3(),
    new Vector3(0, 0, -0.15),
    new Vector3(),
    new Vector3(0, 0.15, 0)
  ]);
  axes.setAttribute(
    'color',
    new Float32BufferAttribute(
      [
        0.86, 0.15, 0.15, 0.86, 0.15, 0.15, 0.08, 0.5, 0.24, 0.08, 0.5, 0.24, 0.15, 0.39, 0.92, 0.15, 0.39,
        0.92
      ],
      3
    )
  );
  const axisLines = new LineSegments(axes, new LineBasicMaterial({ vertexColors: true, depthTest: false }));
  axisLines.renderOrder = 1;
  model.add(axisLines);

  const grouped = new Map<string, PackingResult['placements'][number][]>();
  for (const placement of props.result.placements) {
    const group = grouped.get(placement.cargoId);
    if (group) group.push(placement);
    else grouped.set(placement.cargoId, [placement]);
  }
  props.input.cargo.forEach((cargo, index) => {
    const placements = grouped.get(cargo.id);
    if (!placements?.length) return;
    const color = PACKING_COLORS[index % PACKING_COLORS.length] ?? PACKING_COLORS[0];
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshLambertMaterial({ color }), placements.length);
    model.add(mesh);
    cargoMeshes.set(mesh, { id: cargo.id, color });
    const matrix = new Matrix4();
    placements.forEach((placement, instance) => {
      const { size, x, y, z } = placement;
      // A visual-only inset separates touching boxes; coordinates remain in integer mm.
      matrix.makeScale(size.length * unit * 0.99, size.height * unit * 0.99, size.width * unit * 0.99);
      matrix.setPosition(
        (x + size.length / 2) * unit,
        (z + size.height / 2) * unit,
        -(y + size.width / 2) * unit
      );
      mesh.setMatrixAt(instance, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });
  updateTheme();
  fitCamera();
}

function resize(): void {
  if (!renderer || !host.value) return;
  const width = Math.max(host.value.clientWidth, 1);
  const height = Math.max(host.value.clientHeight, 1);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  fitCamera();
}

function pointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !event.isPrimary) {
    pointer = undefined;
    return;
  }
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
}

function pointerMove(event: PointerEvent): void {
  if (
    pointer?.id === event.pointerId &&
    Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5
  ) {
    pointer.moved = true;
  }
}

function pointerUp(event: PointerEvent): void {
  const start = pointer;
  pointer = undefined;
  if (start?.id !== event.pointerId || start.moved || event.button !== 0 || !renderer || !canvas.value)
    return;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
  const bounds = canvas.value.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return;
  const point = new Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    (-(event.clientY - bounds.top) / bounds.height) * 2 + 1
  );
  camera.updateMatrixWorld();
  model.updateMatrixWorld(true);
  raycaster.setFromCamera(point, camera);
  const hit = raycaster.intersectObjects([...cargoMeshes.keys()], false)[0];
  const cargo =
    hit?.object instanceof InstancedMesh && hit.instanceId !== undefined
      ? cargoMeshes.get(hit.object)
      : undefined;
  emit('select', cargo?.id ?? null);
}

watch(() => [props.input, props.result], rebuild, { deep: true });
watch(() => props.selectedCargoId, updateSelection);
watch(() => [props.view, props.resetKey], fitCamera);

onMounted(() => {
  try {
    if (!canvas.value || !host.value) {
      fail('unavailable');
      return;
    }
    const context = canvas.value.getContext('webgl2', { antialias: true, powerPreference: 'low-power' });
    if (!context) {
      fail('unavailable');
      return;
    }
    renderer = new WebGLRenderer({ canvas: canvas.value, context, antialias: true });
    const light = new DirectionalLight('#ffffff', 2);
    light.position.set(1, 2, 3);
    scene.add(model, new AmbientLight('#ffffff', 1.3), light);
    controls = new OrbitControls(camera, canvas.value);
    controls.enableDamping = false;
    controls.autoRotate = false;
    controls.maxPolarAngle = Math.PI / 2;
    controls.addEventListener('change', requestRender);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host.value);
    themeObserver = new MutationObserver(updateTheme);
    themeObserver.observe(globalThis.document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });
    resize();
    rebuild();
  } catch {
    fail('unavailable');
  }
});

onBeforeUnmount(() => {
  disposed = true;
  release();
});
</script>

<template>
  <div
    ref="host"
    class="relative h-[clamp(18rem,55vh,27.5rem)] min-w-0 w-full overflow-hidden rounded-md border bg-background"
    data-testid="packing-scene"
    :data-status="status"
    :data-render-count="renderCount"
    :data-selected-type="selectedType"
    :data-selected-cargo="selectedCargoId ?? ''"
    :data-view="view"
  >
    <canvas
      ref="canvas"
      v-show="status !== 'unavailable' && status !== 'context-lost'"
      class="block size-full touch-none"
      role="img"
      :aria-label="t('logistics.packing.sceneLabel')"
      data-renderer="three-webgl2"
      @webglcontextlost="contextLost"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="pointer = undefined"
      @pointerleave="pointer = undefined"
    />
    <p
      v-if="status === 'unavailable' || status === 'context-lost'"
      class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground"
      role="status"
    >
      {{ t('logistics.packing.threeUnavailable') }}
    </p>
  </div>
</template>
