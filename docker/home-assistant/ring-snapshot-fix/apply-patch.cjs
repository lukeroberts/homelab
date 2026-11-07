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

function patchCameraSource(source) {
  if (hash(source) === ORIGINAL_SHA256) {
    return EXTRA_IMPORT + source.replace('        if (newSnapshot) {\n', '        if (newSnapshot) {\n' + NORMALIZATION);
  }
  // A container restart retains its writable layer: recognize only this exact patch.
  const unpatched = source.startsWith(EXTRA_IMPORT)
    ? source.slice(EXTRA_IMPORT.length).replace(NORMALIZATION, '')
    : source;
  if (hash(unpatched) === ORIGINAL_SHA256 && source.includes(NORMALIZATION)) return source;
  throw new Error('Unsupported Ring-MQTT camera source: snapshot patch not applied');
}

module.exports = { patchCameraSource, ORIGINAL_SHA256 };

if (process.argv.includes('--apply')) {
  const file = process.argv[process.argv.indexOf('--apply') + 1] || '/app/ring-mqtt/devices/camera.js';
  const source = fs.readFileSync(file, 'utf8');
  const patched = patchCameraSource(source);
  if (patched !== source) fs.writeFileSync(file, patched);
  console.log('Ring-MQTT 5.9.3 snapshot JPEG normalization verified');
}
