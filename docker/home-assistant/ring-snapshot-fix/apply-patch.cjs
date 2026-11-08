const fs = require('node:fs');
const crypto = require('node:crypto');

const ORIGINAL_SHA256 = 'aab968ac2a4ab0127d5cb9a174f7092b5ebf38dca7b6eafd8cc8fb77952cee52';
const EXTRA_IMPORT = "import normalizeSnapshotJpeg from '../lib/snapshot-jpeg.mjs'\n";
const NORMALIZATION = `            // ring-snapshot-jpeg:v1 — preserve the previous cache on conversion failure.
            try {
                newSnapshot = await normalizeSnapshotJpeg(newSnapshot, pathToFfmpeg)
            } catch {
                this.debug('Discarding invalid snapshot; keeping the previous image')
                return
            }
`;
const hash = (source) => crypto.createHash('sha256').update(source).digest('hex');
const ORIGINAL_SETTINGS = `                autoInterval: savedState?.snapshot?.autoInterval
                    ? savedState.snapshot.autoInterval
                    : true,
                intervalDuration: savedState?.snapshot?.intervalDuration
                    ? savedState.snapshot.intervalDuration
                    : (this.device.operatingOnBattery) ? 600 : 30,
`;
// Only the snapshot-settings restoration portion of upstream PR #1113.
const FIXED_SETTINGS = `                autoInterval: savedState?.snapshot?.autoInterval ?? true,
                // updateDeviceState() saves the duration as 'interval'
                intervalDuration: savedState?.snapshot?.interval
                    ? savedState.snapshot.interval
                    : savedState?.snapshot?.intervalDuration
                        ? savedState.snapshot.intervalDuration
                        : (this.device.operatingOnBattery) ? 600 : 30,
`;

function patchCameraSource(source) {
  // Recognize only stock, the exact previous overlay, or the exact combined overlay.
  const previousSettings = source.replace(FIXED_SETTINGS, ORIGINAL_SETTINGS);
  const original = previousSettings.startsWith(EXTRA_IMPORT)
    ? previousSettings.slice(EXTRA_IMPORT.length).replace(NORMALIZATION, '')
    : previousSettings;
  if (hash(original) !== ORIGINAL_SHA256 || !original.includes(ORIGINAL_SETTINGS)) {
    throw new Error('Unsupported Ring-MQTT camera source: snapshot patch not applied');
  }
  const previousOverlay = EXTRA_IMPORT + original.replace('        if (newSnapshot) {\n', '        if (newSnapshot) {\n' + NORMALIZATION);
  const combinedOverlay = previousOverlay.replace(ORIGINAL_SETTINGS, FIXED_SETTINGS);
  if (![original, previousOverlay, combinedOverlay].includes(source)) {
    throw new Error('Unsupported Ring-MQTT camera source: snapshot patch not applied');
  }
  return combinedOverlay;
}

module.exports = { patchCameraSource, ORIGINAL_SHA256 };

if (process.argv.includes('--apply')) {
  const file = process.argv[process.argv.indexOf('--apply') + 1] || '/app/ring-mqtt/devices/camera.js';
  const source = fs.readFileSync(file, 'utf8');
  const patched = patchCameraSource(source);
  if (patched !== source) fs.writeFileSync(file, patched);
  console.log('Ring-MQTT 5.9.3 snapshot normalization and settings persistence verified');
}
