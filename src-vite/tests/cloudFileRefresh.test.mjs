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
      if (command === 'check_selected_file_info') {
        const check = options.checks?.[args.fileId - 1] ?? true;
        if (check instanceof Error) throw check;
        return check;
      }
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
    '; return { processed, succeeded, skipped, failed, releaseRequested, keptLocal, lastError, running, cancelled, ready, pendingIds, rebuildPreviews, update: () => runRefresh(filesToUpdate()) };')(...Object.values(deps));
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
  await f.state.update();
  assert.ok(f.calls.filter(call => call.command === 'refresh_selected_file_info').every(call => call.args.batchId === 42));
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

test('normal refresh checks without writing until Update is confirmed', async () => {
  const f = fixture([result(1), result(2)], { freeSpace: false, checks: [false, true] });
  await f.run();
  assert.equal(f.state.ready.value, true);
  assert.deepEqual(f.state.pendingIds.value, [2]);
  assert.deepEqual(f.refreshed, []);
  assert.ok(!f.calls.some(call => call.command === 'refresh_selected_file_info'));
  await f.state.update();
  assert.deepEqual(f.calls.filter(call => call.command === 'refresh_selected_file_info').map(call => call.args.fileId), [2]);
});

test('no changes leaves an empty confirmation with no refresh commands', async () => {
  const f = fixture([result(1)], { freeSpace: false, checks: [false] });
  await f.run();
  assert.deepEqual(f.state.pendingIds.value, []);
  assert.equal(f.state.running.value, false);
  assert.equal(f.state.lastError.value, '');
  assert.deepEqual(f.refreshed, []);
});

test('check failures are reported instead of claiming all files are current', async () => {
  const f = fixture([result(1)], { freeSpace: false, checks: [new Error('File not found')] });
  await f.run();
  assert.deepEqual(f.state.pendingIds.value, []);
  assert.match(f.state.lastError.value, /File not found/);
  assert.deepEqual(f.calls.at(-1), { command: 'end_file_refresh_batch', args: { batchId: 42 } });
});

test('skipped originals retain their metadata result without counting as updated', async () => {
  const unchanged = result(1, { skipped: true, file: { id: 1, cloud_only: true, metadata_pending: true } });
  const f = fixture([unchanged], { freeSpace: false });
  await f.run();
  await f.state.update();
  assert.equal(f.state.skipped.value, 1);
  assert.equal(f.state.succeeded.value, 0);
  assert.equal(f.state.failed.value, 0);
  assert.deepEqual(f.refreshed, [unchanged]);
});

test('XMP failure keeps extracted metadata and pending state without reporting success', async () => {
  const partial = result(1, { error: 'XMP import failed: Malformed XML',
    file: { id: 1, icc_profile: 'Display P3', metadata_pending: true } });
  const f = fixture([partial], { freeSpace: false });
  await f.run();
  await f.state.update();
  assert.equal(f.state.succeeded.value, 0);
  assert.equal(f.state.failed.value, 1);
  assert.deepEqual(f.refreshed, [partial]);
  assert.equal(f.state.lastError.value, partial.error);
});

test('preview repair refreshes the full selection even when timestamps are unchanged', async () => {
  const f = fixture([result(1), result(2)], { freeSpace: false, checks: [false, false] });
  await f.run();
  assert.deepEqual(f.state.pendingIds.value, []);
  f.state.rebuildPreviews.value = true;
  await f.state.update();
  const updates = f.calls.filter(call => call.command === 'refresh_selected_file_info');
  assert.deepEqual(updates.map(call => call.args.fileId), [1, 2]);
  assert.ok(updates.every(call => call.args.rebuildPreviews === true));
});

test('cloud-only XMP errors are reported while retaining skipped metadata and pending state', async () => {
  const partial = result(1, { skipped: true, error: 'XMP import failed: Malformed XML',
    file: { id: 1, cloud_only: true, metadata_pending: true, last_scan_time: 12345 } });
  const f = fixture([partial], { freeSpace: false });
  await f.run();
  await f.state.update();
  assert.equal(f.state.failed.value, 1);
  assert.equal(f.state.succeeded.value, 0);
  assert.deepEqual(f.refreshed, [partial]);
  assert.equal(f.state.lastError.value, partial.error);
});
