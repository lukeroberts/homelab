import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { patchCameraSource } = require('../apply-patch.cjs');
const original = readFileSync(process.env.RING_MQTT_CAMERA_SOURCE, 'utf8');

test('rollback restores the upstream snapshot pipeline while retaining settings persistence', () => {
  const patched = patchCameraSource(original);
  const begin = original.indexOf('    async refreshSnapshot(type, image_uuid) {');
  const end = original.indexOf('\n    async startLiveStream(', begin);
  assert.ok(begin > 0 && end > begin);
  const patchedBegin = patched.indexOf('    async refreshSnapshot(type, image_uuid) {');
  const patchedEnd = patched.indexOf('\n    async startLiveStream(', patchedBegin);
  assert.equal(patched.slice(patchedBegin, patchedEnd), original.slice(begin, end));
  assert.ok(!patched.includes('normalizeSnapshotJpeg'));
  assert.ok(patched.includes('autoInterval: savedState?.snapshot?.autoInterval ?? true'));
  assert.equal(patchCameraSource(patched), patched);
});
