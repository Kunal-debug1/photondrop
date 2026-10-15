export const VERSION = 1;
export const HEADER_SIZE = 26;
export const MAX_FRAME_BYTES = 1800;
const MAGIC = [0x50, 0x44];
const encoder = new TextEncoder();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function frameChecksum(packet, payloadLength) {
  const bytes = new Uint8Array(22 + payloadLength);
  bytes.set(packet.subarray(0, 22));
  bytes.set(packet.subarray(HEADER_SIZE, HEADER_SIZE + payloadLength), 22);
  return crc32(bytes);
}
export function randomTransferId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function hexToBytes(hex) { return Uint8Array.from(hex.match(/.{2}/g) || [], x => parseInt(x, 16)); }
export function bytesToHex(bytes) { return [...bytes].map(v => v.toString(16).padStart(2, '0')).join(''); }
export function encodePacket({ transferId, type, index = 0, total = 0, payload }) {
  const id = typeof transferId === 'string' ? hexToBytes(transferId) : transferId;
  if (id.length !== 8 || payload.length > MAX_FRAME_BYTES - HEADER_SIZE) throw new Error('Frame exceeds protocol size limit.');
  const packet = new Uint8Array(HEADER_SIZE + payload.length);
  packet.set(MAGIC, 0); packet[2] = VERSION; packet[3] = type; packet.set(id, 4);
  const view = new DataView(packet.buffer);
  view.setUint32(12, index); view.setUint32(16, total); view.setUint16(20, payload.length);
  packet.set(payload, HEADER_SIZE);
  view.setUint32(22, frameChecksum(packet, payload.length));
  return packet;
}
export function decodePacket(packet) {
  if (!(packet instanceof Uint8Array) || packet.length < HEADER_SIZE || packet.length > MAX_FRAME_BYTES) throw new Error('Invalid frame length.');
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (packet[0] !== MAGIC[0] || packet[1] !== MAGIC[1]) throw new Error('Not a PhotonDrop frame.');
  if (packet[2] !== VERSION) throw new Error(`Unsupported protocol version ${packet[2]}.`);
  const length = view.getUint16(20);
  if (length !== packet.length - HEADER_SIZE) throw new Error('Frame length does not match payload length (truncated or malformed frame).');
  if (view.getUint32(22) !== frameChecksum(packet, length)) throw new Error('Frame checksum failed.');
  return { version: packet[2], type: packet[3], transferId: bytesToHex(packet.subarray(4, 12)), index: view.getUint32(12), total: view.getUint32(16), payload: packet.slice(HEADER_SIZE) };
}
export const encodeManifest = value => encoder.encode(JSON.stringify(value));
export const decodeManifest = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

// Text transport is base64url. The protocol packet itself remains binary; this wrapper
// keeps QR libraries interoperable without requiring nonstandard QR byte-mode handling.
export function toQrText(packet) {
  let binary = ''; for (let i = 0; i < packet.length; i++) binary += String.fromCharCode(packet[i]);
  return `PD1:${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
export function fromQrText(text) {
  if (!text.startsWith('PD1:')) throw new Error('This QR code is not a PhotonDrop frame.');
  const b64 = text.slice(4).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return decodePacket(bytes);
}
