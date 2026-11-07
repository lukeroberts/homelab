import { spawn } from 'node:child_process';

const isJpeg = (buffer) => Buffer.isBuffer(buffer) && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

/** Normalize a fetched still payload; never open a network or live-video source. */
export default async function normalizeSnapshotJpeg(input, ffmpegPath, { timeoutMs = 5000, maxInputBytes = 8 * 1024 * 1024, maxOutputBytes = 8 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new Error('Empty snapshot');
  if (input.length > maxInputBytes) throw new Error('Snapshot input exceeds limit');
  if (isJpeg(input)) return input;
  const annexB = input.subarray(0, 4).equals(Buffer.from([0, 0, 0, 1])) || input.subarray(0, 3).equals(Buffer.from([0, 0, 1]));
  if (!annexB) throw new Error('Unsupported snapshot format');
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-protocol_whitelist', 'pipe', '-f', 'h264', '-i', 'pipe:0', '-frames:v', '1', '-c:v', 'mjpeg', '-threads', '1', '-f', 'image2pipe', 'pipe:1'];
    const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Snapshot conversion timed out'));
    }, timeoutMs);
    timer.unref();
    child.on('error', () => finish(new Error('Snapshot converter unavailable')));
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill('SIGKILL');
        finish(new Error('Snapshot output exceeds limit'));
        return;
      }
      chunks.push(chunk);
    });
    child.on('close', (code) => {
      const output = Buffer.concat(chunks);
      if (code !== 0 || !isJpeg(output)) finish(new Error('Snapshot conversion did not produce JPEG'));
      else finish(null, output);
    });
    child.stdin.end(input);
  });
}
