# Ring-MQTT 5.9.3 settings-only overlay — rollback pending deployment

## Current change (supersedes the historical proposal below)

Remove only the active H.264-to-JPEG workaround. The upstream snapshot fetch/cache/publication method is restored byte-for-byte; non-JPEG responses will again be published unchanged. This does not establish why Ring sometimes returns H.264.

Keep the persistence backport, original defaults/state writer, image, environment, credentials, volumes and all other services unchanged. Preserve All/60 seconds, `autoInterval: false`, and the 180-second ding hold. The guard accepts only pinned stock, exact JPEG-only/combined overlays, or the exact settings-only result; all converge to settings-only source. Drift remains rejected.

The renderer no longer installs the helper. `snapshot-jpeg.mjs` and its standalone tests are retained only for recovery; the camera source no longer imports/calls it. Pipeline tests now deliberately assert upstream raw-byte passthrough. Run `rollback.test.mjs` against checksum-pinned stock; run the persistence/snapshot suites against the settings-only output with the helper-module variable set as described below.

**Recovery:** the working combined overlay remains in commit `dc23e605eb8f59f75f51e90b53062afa9f02cc5e` (PR #364). Restore its overlay files and embedded command via a reviewed Git change with the same data/settings. Its older guard does not accept settings-only source, so recovery requires targeted recreation from stock, not merely restarting that historical command over the newer writable layer.

**Deployment blocker:** keep this rollback PR unmerged until a Portainer Ring-MQTT-only deployment path is verified. Standard Git stack redeploy has no service selector and can recreate companions; hourly auto-update makes merging a deployment trigger. Do not disable auto-update, redeploy the full stack, or bypass Portainer with host Compose under Ring-only approval.

After a safe deployment, verify actual source, retained persistence/settings, original mounts/pairings and unchanged HA/Mosquitto/Homebridge IDs/start times. Require two advancing interval snapshot timestamps and decode current stills without starting a stream or ringing the doorbell. Notification/live-preview acceptance remains a user test.

---

# Historical combined-overlay proposal (not the active behavior of this branch)

## Status

Compatibility overlay for the pinned Ring-MQTT release. Local and isolated-container checks pass; production rollout must follow the scoped deployment procedure below.

## Problem and correction

Some Ring still responses contain Annex-B H.264 bytes even though the camera path is advertised as JPEG. Ring-MQTT 5.9.3 caches/publishes those bytes unchanged, and Home Assistant's HomeKit snapshot handler forwards them without transcoding.

Normalize already-fetched still responses before replacing the snapshot cache:

- Keep existing JPEG buffers byte-for-byte unchanged; no FFmpeg process for them.
- Decode Annex-B H.264 still payloads into a single JPEG using the FFmpeg executable already imported by Ring-MQTT. Reject other non-JPEG formats before invoking a decoder; explicitly allow only the `pipe` input protocol.
- Use pipes only, one codec thread, a five-second deadline, and 8 MiB input/output bounds. No RTSP connection, extra snapshot request, network source, or new poll interval.
- If conversion fails, retain the prior cache, timestamp and metadata; publish no malformed image. An invalid first image is not published.
- Do not log image bytes, arbitrary decoder output, credentials, or private URLs.

This is a local compatibility overlay, not an upstream Ring-MQTT release. It must be re-reviewed when changing the pinned image.

## Exact source/configuration change

Only `services.ring-mqtt.command` changes in `../docker-compose.yml`. Its existing startup command gains a preflight Node block that:

1. Writes the reviewed `snapshot-jpeg.mjs` helper into the container's application code directory.
2. Verifies the installed `devices/camera.js` matches the pinned 5.9.3 SHA-256 `aab968ac2a4ab0127d5cb9a174f7092b5ebf38dca7b6eafd8cc8fb77952cee52` (or is exactly the already-applied overlay).
3. Adds a helper import and guarded normalization just before a fetched snapshot replaces the cache.
4. Continues the existing secret-config generation and `/init` startup unchanged.

The patch is reapplied after recreation and recognized after a restart of the same writable container layer. Unexpected source drift fails startup rather than silently patching another version.

No image version, environment value, credential, port, network, named volume, resource limit, MQTT permission, HA camera configuration, or HomeKit identity changes. Existing JPEG-producing cameras bypass conversion. Non-JPEG snapshots on any camera use the same safe normalization path.

Readable source files and tests live here; `render-startup.py` embeds the two runtime files into the single Compose definition. This avoids remote code downloads and Portainer relative-path bind-mount requirements. Regenerate before committing:

```sh
python3 docker/home-assistant/ring-snapshot-fix/render-startup.py
```

## Snapshot-settings persistence backport

The overlay also backports only the saved snapshot settings correction from [upstream PR #1113](https://github.com/tsightler/ring-mqtt/pull/1113), merged into upstream `dev`:

- Restore the saved `snapshot.interval`, accepting legacy `snapshot.intervalDuration` as a fallback.
- Respect an explicitly saved `autoInterval: false` instead of enabling automatic selection at startup.

The state writer and save format remain unchanged. No state-file edits or migrations are required. The other changes in that upstream PR are deliberately excluded. The guard accepts only the checksum-pinned original source, the exact previous snapshot-only overlay (which it upgrades), or the exact combined overlay (which it leaves unchanged on restart). Unexpected or partial modifications still fail closed.

Verify settings after both service restart and container recreation, allowing startup to settle before trusting the first HA readback. A displayed interval before startup completes is not persistence evidence. Keep this backport version-coupled to the pinned image and remove it after upgrading to a verified stable release containing the upstream correction.

## Local verification

Requires Node.js, FFmpeg/ffprobe with libx264 for synthetic fixtures, Python 3, and PyYAML for Compose comparisons. The regression harness extracts the actual `refreshSnapshot` method from a checksum-verified pinned source rather than substituting a mock image-processing pipeline. Only the Ring API boundary is replaced with a local buffer.

Use the official source, not private camera frames, for public/CI tests:

```sh
curl --fail --location https://raw.githubusercontent.com/tsightler/ring-mqtt/v5.9.3/devices/camera.js -o "$TMPDIR/ring-camera.js"
node docker/home-assistant/ring-snapshot-fix/apply-patch.cjs --apply "$TMPDIR/ring-camera.js"
RING_MQTT_CAMERA_SOURCE="$TMPDIR/ring-camera.js" \
SNAPSHOT_NORMALIZER_MODULE="$PWD/docker/home-assistant/ring-snapshot-fix/snapshot-jpeg.mjs" \
node --test docker/home-assistant/ring-snapshot-fix/tests/*.test.mjs
```

Observed tests include malformed H.264 regression, JPEG passthrough, missing decoder, bad/empty images, preservation of previous cache, timeout, byte bounds, source-drift rejection and startup-patch idempotence. The core malformed-snapshot test was observed failing against unmodified upstream code before implementation and passing after it. Exact embedded bootstrap execution was tested twice in a temporary local application tree; shell/Node syntax and Docker Compose rendering were checked.

Actual camera frames used for private regression checks are stored outside this repository and outside any release/build bundle. Do not publish them.

**Runtime compatibility:** the normalizer was also executed as an isolated, read-only subprocess in the already-running pinned Ring-MQTT image, using that image's Node.js v22.22.1 and FFmpeg 8.0-homebridge decoder. The actual malformed still converted to a decodable JPEG; an existing JPEG was unchanged. No application files or service configuration were modified by this check.

**Isolated container preflight:** passed on a separate internal-only Docker network with synthetic broker credentials, no published ports and no production volumes. The full image reached its unauthenticated setup UI; the actual imported camera class converted a synthetic H.264 still into decodable JPEG; restarting the same container preserved the exact overlay; deliberate upstream-source drift failed before configuration generation. All test containers, temporary data and the network were removed and cleanup verified. Production container identities/start times and application source remained unchanged. Standalone camera-class probes must set `RUNMODE=docker` to mirror the image's normal service environment.

**Limits:** the preflight intentionally used no Ring account/token and did not test authenticated Ring cloud behavior. Apple Home notification-preview behavior and the live dashboard still require post-deployment acceptance tests.

## Proposed production scope — separate approval required

1. Capture the current Portainer stack revision and Ring-MQTT container specification; retain its existing persistent data and credentials.
2. Coordinate/temporarily pause the stack's Git auto-update before merging or changing tracked references. A merge can trigger production deployment; do not treat it as publication-only.
3. Publish the reviewed source and single-service command change only after authorization.
4. Apply the new Compose definition using a verified **service-targeted recreation of `ring-mqtt` only**, preserving the existing project, environment, network and named volume. Do not assume a full Portainer stack redeploy leaves other services untouched. If only a stack-wide redeploy is available, obtain explicit approval for its broader interruption before executing it.
5. Expect a brief interruption of Ring camera/alarm/sensor state updates while Ring-MQTT reconnects. This is not permission to operate the alarm, lock, sirens or lights.
6. Read back the running command/source hash, container stability, original token/data mount, broker authorization, and unchanged Homebridge/HA/broker container identities and start times.
7. Confirm the Front Door snapshot is decodable JPEG through both MQTT camera and Generic Camera endpoints. Verify camera streams are idle unless the user is actively viewing.
8. Have the user ring the physical doorbell and long-press the **new** notification to confirm image/live-preview behavior. Retain the original Homebridge accessory until parity is confirmed.

## Rollback

Restore the preceding Compose command/revision and recreate **only Ring-MQTT** from the unmodified pinned image with the same data volume/environment. Recreating, not merely restarting, removes the code overlay from the writable layer. Do not delete `/data`, rotate credentials, unpair cameras, reset HomeKit accessories, or remove Homebridge. Retain all other services and permissions.
