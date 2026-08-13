<script setup lang="ts">
import * as THREE from 'three';
import { useLoop } from '@tresjs/core';
import Vehicle, { type LoopPoint } from './Vehicle.vue';
import RouteLine, { type RoutePoint } from './RouteLine.vue';

const props = withDefaults(defineProps<{ dense?: boolean; reduceMotion?: boolean; paused?: boolean }>(), {
  dense: true,
  reduceMotion: false,
  paused: false,
});

const sceneLoop = useLoop();
watch(
  () => props.paused,
  (isPaused) => (isPaused ? sceneLoop.pause() : sceneLoop.resume()),
  { immediate: true },
);

// -- City grid ---------------------------------------------------------
// Roads run every 4 units on a [-16, 16] grid; buildings sit on the
// offset block centers between them so nothing overlaps a road line.
const ROAD_SPACING = 4;
const HALF = 16;
const roadLines = Array.from({ length: HALF * 2 / ROAD_SPACING + 1 }, (_, i) => -HALF + i * ROAD_SPACING);
const blockCenters = roadLines.slice(0, -1).map((v) => v + ROAD_SPACING / 2);

const gridHelper = new THREE.GridHelper(HALF * 2, (HALF * 2) / ROAD_SPACING, 0x21304f, 0x172038);
(gridHelper.material as THREE.Material).transparent = true;
(gridHelper.material as THREE.Material).opacity = 0.5;

const buildingsMesh = shallowRef<THREE.InstancedMesh | null>(null);

onMounted(() => {
  const cells: { x: number; z: number }[] = [];
  for (const x of blockCenters) {
    for (const z of blockCenters) {
      cells.push({ x, z });
    }
  }
  const count = props.dense ? cells.length : Math.round(cells.length * 0.45);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: '#16213f',
    roughness: 0.55,
    metalness: 0.25,
    emissive: '#0d1730',
    emissiveIntensity: 0.4,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const cell = cells[Math.floor((i / count) * cells.length)]!;
    const jitterX = cell.x + (Math.random() - 0.5) * 1.4;
    const jitterZ = cell.z + (Math.random() - 0.5) * 1.4;
    const isLandmark = Math.random() < 0.06;
    const height = isLandmark ? 4.5 + Math.random() * 2.5 : 0.6 + Math.random() * 2.6;
    const footprint = 1.1 + Math.random() * 0.9;

    dummy.position.set(jitterX, height / 2, jitterZ);
    dummy.scale.set(footprint, height, footprint);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const warmWindow = Math.random() < 0.1;
    const base = warmWindow ? '#43301c' : '#111c38';
    color.set(base).lerp(new THREE.Color('#2e4d8a'), Math.random() * 0.75);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  buildingsMesh.value = mesh;
});

onBeforeUnmount(() => {
  buildingsMesh.value?.geometry.dispose();
  (buildingsMesh.value?.material as THREE.Material | undefined)?.dispose();
});

// -- Vehicles ------------------------------------------------------------
const loopA: LoopPoint[] = [
  { x: -16, z: -16 },
  { x: -16, z: 0 },
  { x: 0, z: 0 },
  { x: 0, z: -16 },
];
const loopB: LoopPoint[] = [
  { x: 4, z: -16 },
  { x: 4, z: -4 },
  { x: 16, z: -4 },
  { x: 16, z: -16 },
];
const loopC: LoopPoint[] = [
  { x: -16, z: 4 },
  { x: -16, z: 16 },
  { x: -4, z: 16 },
  { x: -4, z: 4 },
];
const loopD: LoopPoint[] = [
  { x: 4, z: 4 },
  { x: 4, z: 16 },
  { x: 16, z: 16 },
  { x: 16, z: 4 },
];

const vehicles = props.dense
  ? [
      { loop: loopA, color: '#4facfe', speed: 1.5, offset: 0, selected: true },
      { loop: loopB, color: '#4facfe', speed: 1.9, offset: 0.4, selected: false },
      { loop: loopC, color: '#4facfe', speed: 1.3, offset: 0.15, selected: false },
      { loop: loopD, color: '#4facfe', speed: 2.1, offset: 0.6, selected: false },
    ]
  : [
      { loop: loopA, color: '#4facfe', speed: 1.5, offset: 0, selected: true },
      { loop: loopB, color: '#4facfe', speed: 1.9, offset: 0.4, selected: false },
    ];

// -- Pickup / destination markers + route --------------------------------
const pickup: RoutePoint = { x: -16, y: 0.05, z: -8 };
const waypoint: RoutePoint = { x: -6, y: 0.05, z: -3 };
const destination: RoutePoint = { x: 8, y: 0.05, z: 8 };
const routePoints: RoutePoint[] = [pickup, waypoint, destination];

// -- Camera parallax -------------------------------------------------------
const cameraRef = ref();
const pointer = { x: 0, y: 0 };
const BASE_POS = new THREE.Vector3(6, 22, 24);
const LOOK_AT = new THREE.Vector3(-4, 0, -4);

function onPointerMove(e: PointerEvent) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
}

onMounted(() => {
  if (!props.reduceMotion) window.addEventListener('pointermove', onPointerMove, { passive: true });
});
onBeforeUnmount(() => window.removeEventListener('pointermove', onPointerMove));

const { onBeforeRender } = useLoop();
onBeforeRender(({ elapsed }) => {
  if (!cameraRef.value) return;
  const drift = props.reduceMotion ? 0 : Math.sin(elapsed * 0.08) * 0.6;
  const targetX = BASE_POS.x + pointer.x * 1.4 + drift;
  const targetY = BASE_POS.y - pointer.y * 0.6;
  cameraRef.value.position.x += (targetX - cameraRef.value.position.x) * 0.03;
  cameraRef.value.position.y += (targetY - cameraRef.value.position.y) * 0.03;
  cameraRef.value.lookAt(LOOK_AT);
});
</script>

<template>
  <TresPerspectiveCamera ref="cameraRef" :position="[BASE_POS.x, BASE_POS.y, BASE_POS.z]" :fov="42" />

  <TresFogExp2 :args="['#0b0f19', 0.02]" />
  <TresHemisphereLight :args="['#5b82c9', '#080c16', 0.9]" />
  <TresDirectionalLight :position="[8, 14, 6]" color="#f5a962" :intensity="0.45" />
  <TresAmbientLight color="#2b3f6a" :intensity="0.5" />

  <primitive :object="gridHelper" />
  <primitive v-if="buildingsMesh" :object="buildingsMesh" />

  <Vehicle
    v-for="(v, i) in vehicles"
    :key="i"
    :loop="v.loop"
    :color="v.color"
    :speed="v.speed"
    :start-offset="v.offset"
    :selected="v.selected"
    :active="!reduceMotion"
  />

  <RouteLine :points="routePoints" color="#00f2fe" :reduce-motion="reduceMotion" />

  <!-- Pickup marker -->
  <TresGroup :position="[pickup.x, 0, pickup.z]">
    <TresMesh :rotation="[-Math.PI / 2, 0, 0]">
      <TresRingGeometry :args="[0.3, 0.42, 32]" />
      <TresMeshBasicMaterial color="#4ade80" :transparent="true" :opacity="0.85" />
    </TresMesh>
    <TresMesh :position="[0, 0.3, 0]">
      <TresSphereGeometry :args="[0.12, 16, 16]" />
      <TresMeshStandardMaterial color="#4ade80" emissive="#4ade80" :emissive-intensity="0.8" />
    </TresMesh>
  </TresGroup>

  <!-- Destination marker -->
  <TresGroup :position="[destination.x, 0, destination.z]">
    <TresMesh :rotation="[-Math.PI / 2, 0, 0]">
      <TresRingGeometry :args="[0.3, 0.42, 32]" />
      <TresMeshBasicMaterial color="#00f2fe" :transparent="true" :opacity="0.85" />
    </TresMesh>
    <TresMesh :position="[0, 0.3, 0]">
      <TresConeGeometry :args="[0.14, 0.32, 16]" />
      <TresMeshStandardMaterial color="#00f2fe" emissive="#00f2fe" :emissive-intensity="0.8" />
    </TresMesh>
  </TresGroup>
</template>
