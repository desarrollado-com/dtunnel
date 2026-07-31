/**
 * Envelope binario del túnel — evita JSON+base64 en cuerpos grandes.
 */
export const WIRE_VERSION = 1;
export const WIRE_RES = 1;
export const WIRE_REQ = 2;
export const WIRE_WS_FRAME = 3;

export const BIN_THRESHOLD = 512;

export function uuidToBytes(id) {
  return Buffer.from(String(id).replace(/-/g, ''), 'hex');
}

export function bytesToUuid(buf, offset = 0) {
  const h = buf.subarray(offset, offset + 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function encodeEnvelope(type, id, meta, body = Buffer.alloc(0)) {
  const idBytes = uuidToBytes(id);
  const headerBuf = Buffer.from(JSON.stringify(meta));
  const bodyBuf = body?.length ? body : Buffer.alloc(0);
  const out = Buffer.allocUnsafe(1 + 1 + 16 + 4 + headerBuf.length + bodyBuf.length);
  let o = 0;
  out[o++] = WIRE_VERSION;
  out[o++] = type;
  idBytes.copy(out, o); o += 16;
  out.writeUInt32LE(headerBuf.length, o); o += 4;
  headerBuf.copy(out, o); o += headerBuf.length;
  bodyBuf.copy(out, o);
  return out;
}

export function decodeEnvelope(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf[0] !== WIRE_VERSION) return null;
  const type = buf[1];
  const id = bytesToUuid(buf, 2);
  const headerLen = buf.readUInt32LE(18);
  const headerStart = 22;
  const headerEnd = headerStart + headerLen;
  if (headerEnd > buf.length) return null;
  const meta = JSON.parse(buf.subarray(headerStart, headerEnd).toString('utf8'));
  const body = buf.subarray(headerEnd);
  return { type, id, meta, body };
}

export function isBinaryEnvelope(raw) {
  return Buffer.isBuffer(raw) && raw.length >= 1 && raw[0] === WIRE_VERSION;
}
