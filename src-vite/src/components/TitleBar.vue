<template>

  <!-- Custom Title Bar -->
  <div 
    :class="[
      'relative w-full flex items-center justify-between select-none cursor-default',
      viewName==='ImageViewer' ? 'h-12' : 'h-10',
    ]"
    @contextmenu.prevent
    data-tauri-drag-region
  >
    <!-- Title Name -->
    <!-- Icon & Title Container -->
    <div v-if="isMac" class="flex-1" data-tauri-drag-region></div>
    <div 
      :class="[
        'flex items-center overflow-hidden',
        showDesktopWindowControls ? 'ml-2' : '',
        isMac ? 'justify-center text-center' : ''
      ]"
      data-tauri-drag-region
    >
      <!-- Icon -->
      <img 
        v-if="icon" 
        :src="icon" 
        class="w-5 h-5 mr-2 select-none rounded" 
        data-tauri-drag-region 
      />
      
      <!-- Title Name -->
      <span 
        class="text-nowrap text-base-content/70 overflow-hidden whitespace-pre text-ellipsis"
        data-tauri-drag-region
      >
        {{ titlebar }}
      </span>
    </div>
    <div v-if="isMac" class="flex-1" data-tauri-drag-region></div>

    <!-- Center Slot -->
    <div
      :class="[
        isMac ? 'hidden' : 'flex-1 flex items-center justify-center'
      ]"
      data-tauri-drag-region
    >
      <slot></slot>
    </div>

    <!-- Always centered on the entire title bar, independently of side controls. -->
    <div v-if="fileOperationProgress.kind && viewName === 'Home'"
      class="absolute left-1/2 top-0 h-10 -translate-x-1/2 flex items-center gap-2
             text-base-content/70 text-nowrap pointer-events-none z-10"
      role="status" aria-live="polite" data-tauri-drag-region>
      <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
      <span>{{ fileOperationProgress.kind === 'delete' ? 'Deleting' : 'Moving' }}
        {{ fileOperationProgress.completed }} / {{ fileOperationProgress.total }}</span>
    </div>

    <!-- Window Control Buttons -->
    <div v-if="showDesktopWindowControls" class="h-10 mb-auto flex items-center" @mousedown.stop>
      <IconWinMinus v-if="resizable" 
        class="p-3 w-12 h-full text-base-content/70 hover:text-base-content hover:bg-base-100 transition-colors duration-300" 
        @click.stop="minimizeWindow" 
      />
      <component v-if="resizable" :is="isMaximized ? IconWinRestore : IconWinMaximize" 
        class="p-3 w-12 h-full text-base-content/70 hover:text-base-content hover:bg-base-100 transition-colors duration-300" 
        @click.stop="toggleMaximizeWindow" 
      />
      <IconClose 
        class="p-3 w-12 h-full text-base-content/70 hover:text-base-content hover:bg-red-500 transition-colors duration-300" 
        @click.stop="closeWindow" 
      />
    </div>

  </div>

</template>

<script setup>

import { ref, watch } from 'vue';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow  } from '@tauri-apps/api/window';
import { isWin, isMac, isLinux } from '@/common/utils';
import { fileOperationProgress } from '@/common/fileOperationProgress';

import { 
  IconWinMinus,
  IconWinMaximize,
  IconWinRestore,
  IconClose 
} from '@/common/icons';

const props = defineProps({
  titlebar: {
    type: String,
    required: true,
  },
  viewName: {
    type: String,
    required: false,
  },
  resizable: {
    type: Boolean,
    default: true,
  },
  icon: {
    type: String,
    default: '',
  }
});

const searchValue = ref('');

const appWindow = getCurrentWindow();
const isMaximized = ref(false);
const showDesktopWindowControls = isWin || isLinux;

watch(() => searchValue.value, (newValue) => { 
  console.log('searchValue:', newValue);
  emit('message-from-titlebar', { message: 'search', search: searchValue.value });
});

// drag window
// const onMousedown = (e) => {
//   if (e.detail === 1 && !isMaximized.value) {   // 1: single click
//     appWindow.startDragging();
//   }
// };

const minimizeWindow = () => {
  appWindow.minimize();
};

const toggleMaximizeWindow = () => {
  appWindow.isMaximized().then((maximized) => {
    if (maximized) {
      isMaximized.value = false;
      appWindow.unmaximize();
    } else {
      isMaximized.value = true;
      appWindow.maximize();
    }
  });
};

const closeWindow = () => {
  appWindow.close();
};

</script>

<style>
@media (max-width: 400px) {
  #responsiveDiv {
    visibility: hidden;
  }
}
@media (min-width: 400px) {
  #responsiveDiv {
    visibility: visible;
  }
}
</style>
