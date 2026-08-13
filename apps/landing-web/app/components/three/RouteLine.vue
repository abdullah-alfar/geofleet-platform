<script setup lang="ts">
import * as THREE from 'three';
import { useLoop } from '@tresjs/core';

export interface RoutePoint {
  x: number;
  y?: number;
  z: number;
}

const props = withDefaults(
  defineProps<{
    points: RoutePoint[];
    color?: string;
    reduceMotion?: boolean;
  }>(),
  { color: '#00f2fe', reduceMotion: false },
);

class PartialCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private base: THREE.Curve<THREE.Vector3>,
    private progress: number,
  ) {
    super();
  }
  override getPoint(t: number) {
    return this.base.getPointAt(THREE.MathUtils.clamp(t * this.progress, 0, 1));
  }
}

const curve = new THREE.CatmullRomCurve3(
  props.points.map((p) => new THREE.Vector3(p.x, p.y ?? 0.05, p.z)),
  false,
  'catmullrom',
  0.2,
);

const tubeGeometry = shallowRef<THREE.TubeGeometry | null>(null);
const glowGeometry = shallowRef<THREE.TubeGeometry | null>(null);
const pulseRef = ref();
const revealed = ref(false);

function build(progress: number) {
  tubeGeometry.value?.dispose();
  glowGeometry.value?.dispose();
  const partial = new PartialCurve(curve, Math.max(progress, 0.001));
  tubeGeometry.value = new THREE.TubeGeometry(partial, 48, 0.035, 8, false);
  glowGeometry.value = new THREE.TubeGeometry(partial, 48, 0.09, 8, false);
}

onMounted(() => {
  if (props.reduceMotion) {
    build(1);
    revealed.value = true;
    return;
  }
  const { gsap } = useGsap();
  const proxy = { progress: 0 };
  gsap.to(proxy, {
    progress: 1,
    duration: 2.2,
    delay: 0.3,
    ease: 'power2.inOut',
    onUpdate: () => build(proxy.progress),
    onComplete: () => {
      revealed.value = true;
    },
  });
});

onBeforeUnmount(() => {
  tubeGeometry.value?.dispose();
  glowGeometry.value?.dispose();
});

const { onBeforeRender } = useLoop();
onBeforeRender(({ elapsed }) => {
  if (!revealed.value || props.reduceMotion || !pulseRef.value) return;
  const t = (elapsed * 0.18) % 1;
  const p = curve.getPointAt(t);
  pulseRef.value.position.set(p.x, p.y, p.z);
});
</script>

<template>
  <TresGroup>
    <TresMesh v-if="glowGeometry" :geometry="glowGeometry">
      <TresMeshBasicMaterial :color="color" :transparent="true" :opacity="0.12" />
    </TresMesh>
    <TresMesh v-if="tubeGeometry" :geometry="tubeGeometry">
      <TresMeshBasicMaterial :color="color" :transparent="true" :opacity="0.9" />
    </TresMesh>
    <TresMesh v-if="revealed && !reduceMotion" ref="pulseRef">
      <TresSphereGeometry :args="[0.07, 12, 12]" />
      <TresMeshBasicMaterial color="#ffffff" />
    </TresMesh>
  </TresGroup>
</template>
