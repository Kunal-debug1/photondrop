import { decodeManifest, MAX_FRAME_BYTES, HEADER_SIZE } from './protocol.js';

export class Receiver {
  constructor({ maxFileBytes = 32 * 1024 * 1024 } = {}) { this.maxFileBytes = maxFileBytes; this.reset(); }
  reset() { this.transferId = null; this.manifest = null; this.chunks = new Map(); this.total = null; this.bytes = 0; this.error = null; }
  accept(frame) {
    if (this.transferId && frame.transferId !== this.transferId) throw new Error('A different transfer is active. Cancel or reset before scanning another file.');
    if (!this.transferId) this.transferId = frame.transferId;
    if (frame.type === 0) {
      const manifest = decodeManifest(frame.payload);
      if (manifest.protocol !== 1 || typeof manifest.name !== 'string' || manifest.name.length > 255 || typeof manifest.type !== 'string' || manifest.type.length > 255 || !Number.isSafeInteger(manifest.size) || manifest.size < 0 || manifest.size > this.maxFileBytes || !Number.isSafeInteger(manifest.chunks) || manifest.chunks < 0 || manifest.chunks > 50000 || !/^[0-9a-f]{64}$/.test(manifest.sha256) || (manifest.size === 0) !== (manifest.chunks === 0)) throw new Error('Invalid transfer manifest or file exceeds the configured 32 MiB limit.');
      if (this.manifest && JSON.stringify(this.manifest) !== JSON.stringify(manifest)) throw new Error('Conflicting transfer metadata.');
      if (manifest.chunks > manifest.size || this.bytes > manifest.size) throw new Error('Chunk metadata exceeds the declared file size.');
      this.manifest = manifest;
    } else if (frame.type === 1) {
      if (!Number.isInteger(frame.index) || frame.total < 1 || frame.index >= frame.total || frame.total > 50000) throw new Error('Invalid chunk sequence.');
      if (this.total !== null && this.total !== frame.total) throw new Error('Conflicting chunk totals.');
      this.total = frame.total;
      if (this.manifest && (frame.total !== this.manifest.chunks || frame.index >= frame.total)) throw new Error('Chunk does not match transfer metadata.');
      if (frame.payload.length === 0 || frame.payload.length > MAX_FRAME_BYTES - HEADER_SIZE) throw new Error('Invalid chunk payload size.');
      if (!this.chunks.has(frame.index)) {
        if (this.bytes + frame.payload.length > this.maxFileBytes || (this.manifest && this.bytes + frame.payload.length > this.manifest.size)) throw new Error('Received data exceeds the configured file-size limit.');
        this.chunks.set(frame.index, frame.payload); this.bytes += frame.payload.length;
      }
    } else throw new Error('Unknown frame type.');
    return this.status();
  }
  status() {
    const total = this.manifest?.chunks ?? this.total ?? 0;
    return { transferId: this.transferId, manifest: this.manifest, received: this.chunks.size, total, percent: total ? Math.min(100, this.chunks.size / total * 100) : 0, ready: Boolean(this.manifest && this.chunks.size === this.manifest.chunks) };
  }
  async finish() {
    if (!this.status().ready) throw new Error('Transfer incomplete. Keep scanning for missing frames.');
    const parts = Array.from({ length: this.manifest.chunks }, (_, i) => this.chunks.get(i));
    const blob = new Blob(parts, { type: this.manifest.type || 'application/octet-stream' });
    if (blob.size !== this.manifest.size) throw new Error('Reconstructed size does not match the manifest.');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
    if (digest !== this.manifest.sha256) throw new Error('SHA-256 verification failed. The file was not offered for download.');
    return { blob, sha256: digest, manifest: this.manifest };
  }
}
