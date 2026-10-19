// Local recording export utilities. ZIP entries use UTF-8 filenames.
export function zip(files) {
  const encoder = new TextEncoder(); const chunks = [], entries = []; let offset = 0;
  const crc32 = data => { let crc = -1; for (const b of data) { crc ^= b; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; };
  for (const file of files) {
    const name = encoder.encode(file.name), data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer), crc = crc32(data);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true); header.set(name, 30);
    entries.push({ name, data, crc, offset }); chunks.push(header, data); offset += header.length + data.length;
  }
  const start = offset;
  for (const e of entries) {
    const h = new Uint8Array(46 + e.name.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x800, true);
    v.setUint32(16, e.crc, true); v.setUint32(20, e.data.length, true); v.setUint32(24, e.data.length, true); v.setUint16(28, e.name.length, true); v.setUint32(42, e.offset, true); h.set(e.name, 46); chunks.push(h); offset += h.length;
  }
  const end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true); v.setUint32(12, offset - start, true); v.setUint32(16, start, true); chunks.push(end);
  return new Blob(chunks, { type: 'application/zip' });
}

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
