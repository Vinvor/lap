<template>
  <div class="flex flex-col space-y-2">
    <section aria-labelledby="metadata-import-heading" class="rounded-box p-3 space-y-3 bg-base-300/30 border border-base-content/5 shadow-sm">
      <h2 id="metadata-import-heading" class="font-bold uppercase text-[10px] tracking-widest text-base-content/50">{{ $t('settings.metadata.section_import') }}</h2>
      <div class="flex items-center justify-between gap-4">
        <label for="metadata-import" class="min-w-0 flex flex-col gap-1 text-sm leading-5">
          <span>{{ $t('settings.metadata.import') }}</span>
          <span id="metadata-import-hint" class="text-xs text-base-content/60">{{ $t('settings.metadata.import_hint') }}</span>
        </label>
        <input id="metadata-import" type="checkbox" class="toggle toggle-primary toggle-sm shrink-0" v-model="config.settings.importXmpSidecars" aria-describedby="metadata-import-hint" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { config } from '@/common/config';
</script>
