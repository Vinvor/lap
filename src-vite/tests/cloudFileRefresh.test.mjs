import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { ref } from 'vue';

const source = fs.readFileSync(new URL('../src/components/RefreshFileInfoDialog.vue', import.meta.url), 'utf8');
const body = ts.transpile(source.split('<script setup lang="ts">')[1].split('</script>')[0]
  .replace(/^import .*;\n/gm, ''), { target: ts.ScriptTarget.ES2022 });
function fixture(responses, options = {}) {
  let responseIndex = 0;
  let mounted;
  const refreshed = [];
  const calls = [];
  const props = { fileIds: responses.map((_, i) => i + 1), libraryId: 'test', freeSpace: options.freeSpace ?? true,
    finishRefresh: async results => refreshed.push(...results) };
  const deps = {
    ref, defineProps: () => props, defineEmits: () => () => {},
    onMounted: callback => { mounted = callback; }, onBeforeUnmount: () => {}, watch: () => {},
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === 'begin_file_refresh_batch') {
        if (options.beginError) throw options.beginError;
        return 42;
      }
      if (command === 'end_file_refresh_batch') return;
      const response = responses[responseIndex++];
      if (response instanceof Error) throw response;
      return response;
    },
    config: { settings: { thumbnailSize: 512 } }, libConfig: { _libraryId: 'test' },
    getRawDisplayOptions: () => ({}),
    useUIStore: () => ({ pushInputHandler() {}, removeInputHandler() {} }),
    window: { addEventListener() {}, removeEventListener() {} }, console: { error() {} },
  };
  const state = new Function(...Object.keys(deps), body +
    '; return { processed, succeeded, failed, releaseRequested, keptLocal, lastError, running, cancelled };')(...Object.values(deps));
  return { state, refreshed, calls, run: () => mounted() };
}
const result = (id, extra = {}) => ({ file: { id, cloud_only: false, metadata_pending: false },
  size_delta: 10, skipped: false, release_requested: false, error: null, ...extra });

test('accepted asynchronous release requests are reported without claiming the file is already cloud-only', async () => {
  const updated = result(1, { release_requested: true });
  const f = fixture([updated]);
  await f.run();
  assert.equal(f.state.releaseRequested.value, 1);
  assert.equal(f.state.keptLocal.value, 0);
  assert.equal(f.state.succeeded.value, 1);
  assert.equal(f.refreshed[0].file.cloud_only, false);
});

test('thumbnail failure still refreshes the downloaded file, metadata and size delta', async () => {
  const updated = result(1, { error: 'Thumbnail could not be cached' });
  const f = fixture([updated]);
  await f.run();
  assert.deepEqual(f.refreshed, [updated]);
  assert.equal(f.state.failed.value, 1);
  assert.equal(f.state.succeeded.value, 0);
  assert.equal(f.state.keptLocal.value, 1);
  assert.equal(f.state.lastError.value, updated.error);
});

test('a mixed batch retains partial updates and continues after command and release failures', async () => {
  const partial = result(2, { error: 'Release refused' });
  const complete = result(3, { release_requested: true, file: { id: 3, cloud_only: true } });
  const f = fixture([new Error('Download failed'), partial, complete]);
  await f.run();
  assert.deepEqual(f.refreshed, [partial, complete]);
  assert.equal(f.state.processed.value, 3);
  assert.equal(f.state.failed.value, 2);
  assert.equal(f.state.succeeded.value, 1);
  assert.equal(f.state.running.value, false);
  assert.equal(f.calls[0].command, 'begin_file_refresh_batch');
  assert.deepEqual(f.calls.at(-1), { command: 'end_file_refresh_batch', args: { batchId: 42 } });
  assert.ok(f.calls.slice(1, -1).every(call => call.command === 'index_cloud_file' && call.args.batchId === 42));
});

test('normal refresh forwards the shared index and releases it after completion', async () => {
  const f = fixture([result(1), new Error('Refresh failed')], { freeSpace: false });
  await f.run();
  assert.ok(f.calls.slice(1,-1).every(call => call.command === 'refresh_selected_file_info' && call.args.batchId === 42));
  assert.deepEqual(f.calls.at(-1), { command: 'end_file_refresh_batch', args: { batchId: 42 } });
  assert.equal(f.state.failed.value,1);
});
test('cancellation releases the batch without refreshing any files', async () => {
  const f = fixture([result(1)]);
  f.state.cancelled.value = true;
  await f.run();
  assert.deepEqual(f.calls.map(call => call.command), ['begin_file_refresh_batch','end_file_refresh_batch']);
  assert.equal(f.state.running.value,false);
});
test('failure to begin a batch is surfaced and does not invoke refresh commands', async () => {
  const f = fixture([result(1)], { beginError: new Error('Library changed') });
  await f.run();
  assert.deepEqual(f.calls.map(call => call.command), ['begin_file_refresh_batch']);
  assert.match(f.state.lastError.value,/Library changed/);
  assert.equal(f.state.running.value,false);
});
