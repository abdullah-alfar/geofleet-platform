<script setup lang="ts">
import * as THREE from 'three';
import { useLoop } from '@tresjs/core';

export interface LoopPoint {
  x: number;
  z: number;
}

const props = withDefaults(
  defineProps<{
    loop: LoopPoint[];
    speed?: number;
    color?: string;
    selected?: boolean;
    startOffset?: number;
    active?: boolean;
  }>(),
  { speed: 1.6, color: '#4facfe', selected: false, startOffset: 0, active: true },
);

const emit = defineEmits<{ move: [{ x: number; y: number; z: number; heading: number }] }>();

const groupRef = ref();
const pulseRef = ref();

const segmentLengths = props.loop.map((p, i) => {
  const next = props.loop[(i + 1) % props.loop.length]!;
  return Math.hypot(next.x - p.x, next.z - p.z);
});
const totalLength = segmentLengths.reduce((a, b) => a + b, 0);

let distance = props.startOffset * totalLength;
let pulseClock = props.startOffset * 2;

function pointAt(dist: number): { x: number; z: number; heading: number } {
  let d = ((dist % totalLength) + totalLength) % totalLength;
  for (let i = 0; i < props.loop.length; i++) {
    const segLen = segmentLengths[i]!;
    if (d <= segLen || i === props.loop.length - 1) {
      const a = props.loop[i]!;
      const b = props.loop[(i + 1) % props.loop.length]!;
      const t = segLen === 0 ? 0 : d / segLen;
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        heading: Math.atan2(b.z - a.z, b.x - a.x),
      };
    }
    d -= segLen;
  }
  const first = props.loop[0]!;
  return { x: first.x, z: first.z, heading: 0 };
}

const bodyColor = computed(() => (props.selected ? '#00f2fe' : props.color));
const RIDE_Y = 0.16;

onMounted(() => {
  const { x, z, heading } = pointAt(distance);
  groupRef.value?.position.set(x, RIDE_Y, z);
  if (groupRef.value) groupRef.value.rotation.y = -heading;
});

const { onBeforeRender } = useLoop();
onBeforeRender(({ delta }) => {
  if (!props.active) return;
  distance += props.speed * delta;
  pulseClock += delta;

  const { x, z, heading } = pointAt(distance);
  if (groupRef.value) {
    groupRef.value.position.set(x, RIDE_Y, z);
    groupRef.value.rotation.y = -heading;
  }
  if (pulseRef.value) {
    const t = (pulseClock % 1.6) / 1.6;
    const scale = 0.5 + t * 2.2;
    pulseRef.value.scale.set(scale, scale, scale);
    const mat = pulseRef.value.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, 0.6 * (1 - t));
  }

  emit('move', { x, y: RIDE_Y, z, heading });
});
</script>

<template>
  <TresGroup ref="groupRef">
    <TresMesh :position="[0, 0, 0]" cast-shadow>
      <TresBoxGeometry :args="[0.42, 0.18, 0.22]" />
      <TresMeshStandardMaterial :color="bodyColor" :emissive="bodyColor" :emissive-intensity="selected ? 0.9 : 0.35" :roughness="0.35" :metalness="0.4" />
    </TresMesh>
    <TresMesh :position="[0, 0.13, 0]">
      <TresBoxGeometry :args="[0.22, 0.1, 0.18]" />
      <TresMeshStandardMaterial color="#0b0f19" :roughness="0.2" />
    </TresMesh>

    <TresMesh ref="pulseRef" :position="[0, -0.12, 0]" :rotation="[-Math.PI / 2, 0, 0]">
      <TresRingGeometry :args="[0.28, 0.34, 32]" />
      <TresMeshBasicMaterial :color="bodyColor" :transparent="true" :opacity="0.5" :side="THREE.DoubleSide" />
    </TresMesh>
  </TresGroup>
</template>
