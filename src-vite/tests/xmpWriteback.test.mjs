import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { computed, markRaw, ref } from 'vue';

const menuSource = fs.readFileSync(new URL('../src/common/fileMenu.ts', import.meta.url), 'utf8');
const locale = JSON.parse(fs.readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'));
const availability = fs.readFileSync(new URL('../src/common/availability.ts', import.meta.url), 'utf8');
const requiresOriginalAction = new Function(ts.transpile(availability.slice(availability.indexOf('const originalActions')).replace(/export /g, '')) + ';return requiresOriginalAction;')();
const icons = Object.fromEntries([...new Set(menuSource.match(/\bIcon\w+/g))].map(name => [name, {}]));
const menuCode = ts.transpile(menuSource.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\n/gm, '').replace(/export /g, ''), { target: ts.ScriptTarget.ES2022 });
const deps = {
  computed, markRaw, ...icons,
  config: { externalAppsFor: () => [], defaultExternalApp: () => null, main: { sidebarIndex: 0 }, settings: { face: { enabled: false } } },
  libConfig: { album: { id: 1 }, activePane: 'album' }, SIDEBAR: { ALBUM: 1 },
  DEFAULT_PLATFORM: 'mac', getShortcutLabel: () => '', isWin: false,
  isOriginalUnavailable: file => !!file?.unavailable, requiresOriginalAction,
};
const useFileMenuItems = new Function(...Object.keys(deps), menuCode + ';return useFileMenuItems;')(...Object.values(deps));

test('single and selection menus offer XMP save without an overwrite-import action', () => {
  for (const selected of [false, true]) {
    const calls = [];
    const options = { selectMode: ref(selected), selectionCount: ref(2), selectionHasUnavailable: ref(false), selectionMediaKind: ref('image') };
    const file = ref({ id: 1, name: 'photo.jpg', file_type: 1 });
    const menu = useFileMenuItems(file, ref(locale), true, key => key, action => calls.push(action), options);
    const item = menu.value.find(item => item.action?.actionName === 'save-xmp');
    assert.ok(item);
    assert.equal(menu.value.some(item => item.action?.actionName === 'import-xmp'), false);
    item.action();
    assert.deepEqual(calls, ['save-xmp']);
    file.value.unavailable = true;
    options.selectionHasUnavailable.value = true;
    const blocked = menu.value.find(item => item.action?.actionName === 'save-xmp');
    assert.equal(blocked.disabled, true);
    blocked.action();
    assert.deepEqual(calls, ['save-xmp']);
  }
});

const content = fs.readFileSync(new URL('../src/components/Content.vue', import.meta.url), 'utf8');
const actionCode = content.slice(content.indexOf("    'save-xmp': async () => {"), content.indexOf("    'favorite':", content.indexOf("    'save-xmp': async () => {")));
test('XMP save sends the complete selection and library identity, reporting partial failure', async () => {
  const requests = [], messages = [];
  const values = {
    selectMode: ref(true), selectedFileIds: new Set([10, 20, 30]),
    fileList: ref([{ id: 10 }]), selectedItemIndex: ref(0), libConfig: { _libraryId: 'library-a' },
    saveXmpMetadata: async (...args) => { requests.push(args); return { savedIds: [10, 20], failures: [{ fileId: 30, error: 'read-only' }] }; },
    toast: { success: text => messages.push(text), error: text => messages.push(text) },
    t: (key, { count }) => `${key}:${count}`,
  };
  const save = new Function(...Object.keys(values), `return ({${actionCode}})['save-xmp'];`)(...Object.values(values));
  await save();
  assert.deepEqual(requests[0], [[10, 20, 30], 'library-a']);
  assert.deepEqual(messages, ['menu.file.xmp_save_success:2', 'menu.file.xmp_save_failed:1: read-only']);
  values.selectMode.value = false;
  await save();
  assert.deepEqual(requests[1], [[10], 'library-a']);
});
