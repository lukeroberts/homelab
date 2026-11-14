import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { patchCameraSource } = require('../apply-patch.cjs');

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const sourcePath = process.env.RING_MQTT_CAMERA_SOURCE;
assert.ok(sourcePath, 'Set RING_MQTT_CAMERA_SOURCE to the pinned upstream or patched camera.js');
const source = readFileSync(sourcePath, 'utf8');
assert.equal(patchCameraSource(source), source, 'Compile only the checksum-verified patched upstream source');
const start = source.indexOf('    async refreshSnapshot(type, image_uuid) {');
const end = source.indexOf('\n    async startLiveStream(', start);
assert.ok(start >= 0 && end > start, 'Pinned refreshSnapshot method must exist');
const method = source.slice(start, end).trim().replace('async refreshSnapshot(', 'async function refreshSnapshot(');
const normalize = process.env.SNAPSHOT_NORMALIZER_MODULE
  ? (await import(pathToFileURL(process.env.SNAPSHOT_NORMALIZER_MODULE).href)).default
  : undefined;
const refreshSnapshot = new Function('normalizeSnapshotJpeg', 'pathToFfmpeg', 'utils', `return (${method})`)(normalize, ffmpeg, { sleep: async () => {} });

function syntheticH264() {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=1', '-frames:v', '1', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-f', 'h264', 'pipe:1'], { timeout: 10000 });
  assert.equal(result.status, 0, 'Synthetic H.264 fixture generation must work');
  return result.stdout;
}

function cameraWithSnapshot(buffer, previous = null) {
  const camera = {
    device: { snapshotsAreBlocked: false, getNextSnapshot: async () => buffer },
    data: { snapshot: { cache: previous, cacheType: previous ? 'previous' : null, timestamp: 1 } },
    published: [],
    debug() {},
    publishSnapshot() { this.published.push(this.data.snapshot.cache); },
  };
  return camera;
}

function assertDecodableJpeg(buffer, expectedWidth, expectedHeight) {
  assert.equal(buffer.subarray(0, 3).toString('hex'), 'ffd8ff', 'Published snapshot must be JPEG, not raw H.264');
  const result = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', 'pipe:0'], { input: buffer, timeout: 10000 });
  assert.equal(result.status, 0, 'JPEG must be decodable');
  const stream = JSON.parse(result.stdout).streams[0];
  assert.equal(stream.codec_name, 'mjpeg');
  assert.equal(stream.width, expectedWidth);
  assert.equal(stream.height, expectedHeight);
}

test('rolled-back Ring-MQTT publishes fetched H.264 bytes unchanged', async () => {
  const input = syntheticH264();
  const camera = cameraWithSnapshot(input);
  await refreshSnapshot.call(camera, 'interval');
  assert.equal(camera.published.length, 1);
  assert.strictEqual(camera.published[0], input);
});

test('snapshot conversion bounds input and output data size', async () => {
  const input = syntheticH264();
  await assert.rejects(normalize(input, ffmpeg, { maxInputBytes: 1 }), /input exceeds/);
  await assert.rejects(normalize(input, ffmpeg, { maxOutputBytes: 1 }), /output exceeds/);
});

test('existing JPEG is returned byte-for-byte without starting a converter', async () => {
  const jpeg = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0', '-frames:v', '1', '-c:v', 'mjpeg', '-threads', '1', '-f', 'image2pipe', 'pipe:1'], { input: syntheticH264(), timeout: 10000 });
  assert.equal(jpeg.status, 0);
  assert.strictEqual(await normalize(jpeg.stdout, '/nonexistent/converter'), jpeg.stdout);
});

test('rolled-back upstream pipeline does not filter non-JPEG data', async () => {
  const previous = Buffer.from('previous-cache-sentinel');
  const input = Buffer.from('not an image');
  const camera = cameraWithSnapshot(input, previous);
  await refreshSnapshot.call(camera, 'interval');
  assert.strictEqual(camera.data.snapshot.cache, input);
  assert.equal(camera.data.snapshot.cacheType, 'interval');
  assert.equal(camera.published.length, 1);
});

test('rolled-back upstream pipeline publishes a non-JPEG first snapshot', async () => {
  const input = Buffer.from('not an image');
  const camera = cameraWithSnapshot(input);
  await refreshSnapshot.call(camera, 'interval');
  assert.strictEqual(camera.data.snapshot.cache, input);
  assert.equal(camera.published.length, 1);
});

test('a missing converter fails without exposing payload content', async () => {
  await assert.rejects(normalize(syntheticH264(), '/nonexistent/converter'), { message: 'Snapshot converter unavailable' });
});

test('empty snapshots are rejected before starting a converter', async () => {
  await assert.rejects(normalize(Buffer.alloc(0), '/nonexistent/converter'), { message: 'Empty snapshot' });
});

test('the exact startup patch can be applied repeatedly', () => {
  assert.equal(patchCameraSource(source), source);
});

test('upstream source drift prevents startup patching', () => {
  assert.throws(() => patchCameraSource(source + '\n// unexpected upstream change\n'), /Unsupported Ring-MQTT/);
});

test('unsupported snapshot formats are rejected before running a decoder', async () => {
  await assert.rejects(normalize(Buffer.from('#EXTM3U\nhttps://example.test/stream\n'), '/nonexistent/converter'), { message: 'Unsupported snapshot format' });
});

test('snapshot conversion has a bounded runtime', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-test-'));
  const executable = join(dir, 'slow-converter');
  writeFileSync(executable, '#!/bin/sh\nexec sleep 0.3\n', { mode: 0o700 });
  try {
    await assert.rejects(normalize(syntheticH264(), executable, { timeoutMs: 30 }), /timed out/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
