# PhotonDrop

PhotonDrop is a static, local-first web app that moves files between two screens with animated QR codes. It has no backend, account, analytics, upload, or transfer-time network dependency. Both devices open the same app; one sends and the other scans.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open the Vite URL on a computer for development. For phone-to-phone use, serve the built app over HTTPS on a reachable LAN host (the hosting network is used only to load the app). Load the app on both phones before disconnecting from the network. The service worker caches same-origin assets; after its first install, reload once while online so the app shell and bundled assets are cached. Then the transfer itself requires no network.

```sh
npm run build
npm run preview -- --host 0.0.0.0
```

Deploy the contents of `dist/` to any static HTTPS host. No server-side code is required. Install through the browser's Add to Home Screen / Install app menu where offered.

### Deploy to GitHub Pages

The repository includes a GitHub Actions workflow at `.github/workflows/deploy.yml`. Push the project to a GitHub repository with a `main` branch, then open **Settings → Pages** and choose **GitHub Actions** as the build and deployment source. The workflow runs `npm ci` and `npm run build`, then publishes `dist/` on each push. GitHub will show the resulting HTTPS URL under Settings → Pages or in the workflow deployment environment. Vite uses relative asset paths so the app works at the repository subpath URL.

## Transfer instructions

1. Open PhotonDrop on both devices. On the receiving phone choose **Receive a file**, then enable camera access.
2. On the sending device choose **Send a file**, select or drop a file, and start transmission.
3. Keep the sender QR fully visible and scan from the receiver. The receiver counts unique chunks; duplicates are ignored and missing frames repeat on later cycles.
4. The Save button appears only after all chunks arrive and the reconstructed bytes match the advertised SHA-256.

The initial maximum file size is 32 MiB per receiver; sender and receiver enforce the same limit. Chunks are 900 bytes by default. Select 600 bytes for difficult cameras or 1200 bytes for a stable, close setup. Frame rate is a target; browser scheduling, QR density, screen refresh, focus, lighting, and camera processing determine the actual rate. Since the protocol has no return channel, the sender cannot know which frames were read. Keep both screens active until completion; the sender pauses when backgrounded. There are no acknowledgements or fabricated receiver throughput figures.

The landing screen's local benchmark exercises bundled QR encode/decode in the current browser and reports a deliberately simulated 20% frame-drop/repeat scenario plus a browser heap snapshot where exposed. It is a decoder microbenchmark, not a measurement of camera optics, screen refresh, or real-world transfer throughput.

## Browser and privacy notes

- Camera access requires a secure context (HTTPS or localhost) and user permission. Browser/device support and available camera selection vary; some mobile browsers require a user gesture to start the camera.
- The application processes bytes in the browser. SHA-256 detects accidental changes but does not authenticate a sender, encrypt the file, or make QR frames confidential. Do not use this as a secure identity or secrecy channel.
- Received filenames are treated as display/download metadata; transferred files are never opened or executed automatically. The receiver holds file chunks in memory until verification. Keep within the configured size limit and available device memory.
- Browser downloads can open a save dialog or go to the default Downloads location depending on platform. iOS and some embedded browsers may have different save/share flows.
- Storage eviction can remove the offline cache. Open the app online again if it no longer loads offline.

## Protocol v1

Each QR contains `PD1:` followed by unpadded base64url text carrying a binary packet (the wrapper is for QR library interoperability). Packet bytes, big-endian integers:

| Offset | Size | Meaning |
|---:|---:|---|
| 0 | 2 | Magic `PD` |
| 2 | 1 | Version (`1`) |
| 3 | 1 | Frame type: `0` manifest, `1` data chunk |
| 4 | 8 | Random transfer identifier |
| 12 | 4 | Chunk index (zero for manifest) |
| 16 | 4 | Total data chunks |
| 20 | 2 | Payload byte length |
| 22 | 4 | CRC-32 of bytes 0–21 followed by payload (IEEE polynomial) |
| 26 | variable | Payload |

Manifest payload is UTF-8 JSON with protocol, sanitized display name, MIME type, byte size, chunk count, and SHA-256. Chunk payloads are raw file bytes. A manifest is repeated once per cycle; chunk frames cycle in order, with no acknowledgements. The receiver bounds packet sizes, file bytes, chunk count, checks CRC and SHA-256, and rejects mismatched IDs and metadata. Future erasure recovery can add a new version/frame type; v1 does not claim fountain coding. Optional authenticated encryption would need a separately specified key agreement such as an explicitly user-verified ephemeral public-key fingerprint exchange; QR transfer alone does not establish a trusted pairing.

## Development and validation

```sh
npm test
npm run build
```

Automated tests cover packet serialization, wrapper parsing, corruption/version/length rejection, empty and multi-chunk files, duplicate and reordered frames, missing chunks, transfer ID mismatch, hash verification, restart, and receiver size/memory bounds. They do not replace optical device testing.

### Two-phone test plan

Use a built HTTPS deployment on two physical phones. Transfer a small text file, a photo, and a file near the configured limit; compare the downloaded SHA-256 with the original. Repeat with 600/900/1200-byte chunks and 3/5/8 fps. Test dim and bright screens, several camera distances, direct and angled views, low and bright ambient lighting, and portrait/landscape. Deliberately interrupt line of sight and confirm the UI remains incomplete until every unique chunk is rescanned. Verify cancel/reset, backgrounding, permission denial/retry, and save/open behavior on Android and iOS. Record observed completion time, successful transfer count, and any camera-specific issues; do not infer that desktop tests prove phone compatibility.

## Structure

- `src/protocol.js`: v1 packet format, CRC, QR text wrapper.
- `src/receiver.js`: bounded chunk store and ordered, hash-verified reconstruction.
- `src/main.js`: navigation, file processing, QR/camera loops and controls.
- `src/style.css`: responsive accessible interface.
- `public/sw.js`: local app-shell and asset cache.
- `test/protocol.test.js`: protocol and reconstruction test harness.
