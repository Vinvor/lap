<template>
  <div ref="viewport" class="overflow-hidden shrink-0">
    <div ref="content" class="flow-root"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const viewport = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
let observer: ResizeObserver | undefined;
let animation: Animation | undefined;
let motion: MediaQueryList | undefined;
let targetHeight = 0;

function resize(animate = true, reset = false) {
  if (!viewport.value || !content.value) return;
  const height = content.value.getBoundingClientRect().height;
  if (!reset && Math.abs(height - targetHeight) < 0.5) return;
  const previous = viewport.value.getBoundingClientRect().height;
  animation?.cancel();
  animation = undefined;
  targetHeight = height;
  viewport.value.style.height = `${height}px`;
  if (!animate || motion?.matches || Math.abs(height - previous) < 0.5) return;
  animation = viewport.value.animate([
    { height: `${previous}px` }, { height: `${height}px` },
  ], { duration: 140, easing: 'ease-out' });
}
function motionChanged() { resize(false, true); }
onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  motion.addEventListener('change', motionChanged);
  resize(false, true);
  observer = new ResizeObserver(() => resize());
  if (content.value) observer.observe(content.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  animation?.cancel();
  motion?.removeEventListener('change', motionChanged);
});
</script>
