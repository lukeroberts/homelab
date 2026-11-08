import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { patchCameraSource } = require('../apply-patch.cjs');
assert.ok(process.env.RING_MQTT_CAMERA_SOURCE, 'Provide the pinned camera source');
const source = patchCameraSource(readFileSync(process.env.RING_MQTT_CAMERA_SOURCE, 'utf8'));
assert.equal(patchCameraSource(source), source, 'Only evaluate checksum-verified source');
const start = source.indexOf('            snapshot: {');
const end = source.indexOf('            stream: {', start);
assert.ok(start >= 0 && end > start);
const snapshotConstructor = new Function('savedState', 'return ({' + source.slice(start, end) + '}).snapshot');
const modeStart = source.indexOf('    updateSnapshotMode() {');
const modeEnd = source.indexOf('\n    }', modeStart) + '\n    }'.length;
assert.ok(modeStart >= 0 && modeEnd > modeStart);
const updateMode = new Function('return (' + source.slice(modeStart, modeEnd).trim().replace('updateSnapshotMode()', 'function updateSnapshotMode()') + ')')();

function restore(saved) {
  const camera = { device: { operatingOnBattery: true, isDoorbot: true, data: { settings: { lite_24x7: { enabled: true, frequency_secs: 3600 } } } }, data: {} };
  camera.data.snapshot = snapshotConstructor.call(camera, saved);
  updateMode.call(camera);
  return camera.data.snapshot;
}

test('a saved manual interval survives constructor restore and automatic mode calculation', () => {
  const snapshot = restore({ snapshot: { mode: 'All', interval: 60, autoInterval: false } });
  assert.equal(snapshot.intervalDuration, 60);
  assert.equal(snapshot.autoInterval, false);
  assert.equal(snapshot.interval, true);
  assert.equal(snapshot.mode, 'All');
});

test('the actual state writer round-trips a manual interval through constructor restore', () => {
  const begin = source.indexOf('    updateDeviceState() {');
  const finish = source.indexOf('\n    }', begin) + '\n    }'.length;
  assert.ok(begin >= 0 && finish > begin);
  const save = new Function('return (' + source.slice(begin, finish).trim().replace('updateDeviceState()', 'function updateDeviceState()') + ')')();
  let saved;
  save.call({ device: { isDoorbot: true }, data: { snapshot: { mode: 'All', autoInterval: false, intervalDuration: 60 }, event_select: { state: 'Motion 1' }, motion: { duration: 180 }, ding: { duration: 180 } }, setSavedState(value) { saved = value; } });
  assert.deepEqual(saved.snapshot, { mode: 'All', autoInterval: false, interval: 60 });
  assert.equal(restore(saved).intervalDuration, 60);
});

test('the legacy intervalDuration field is accepted without a state migration', () => {
  assert.equal(restore({ snapshot: { mode: 'All', intervalDuration: 90, autoInterval: false } }).intervalDuration, 90);
});

test('the current saved interval field takes precedence over a legacy field', () => {
  assert.equal(restore({ snapshot: { mode: 'All', interval: 60, intervalDuration: 90, autoInterval: false } }).intervalDuration, 60);
});

test('missing manual configuration retains the upstream automatic interval selection', () => {
  const snapshot = restore({ snapshot: { mode: 'All' } });
  assert.equal(snapshot.autoInterval, true);
  assert.equal(snapshot.intervalDuration, 3600);
});

test('the combined overlay is restart-idempotent and rejects unexpected drift', () => {
  assert.equal(patchCameraSource(source), source);
  assert.throws(() => patchCameraSource(source + '\n// unexpected change\n'), /Unsupported Ring-MQTT/);
});
