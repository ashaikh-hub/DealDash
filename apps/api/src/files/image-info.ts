/** Reads width and height from the file header (PNG IHDR, JPEG SOF). No image library: only the header is parsed. */
export function imageDimensions(data: Buffer): { width: number; height: number } | null {
  // PNG: 8-byte signature, then the IHDR chunk (width and height are big-endian uint32 at offsets 16 and 20).
  if (data.length >= 24 && data[0] === 0x89 && data.subarray(1, 4).toString('latin1') === 'PNG') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  // JPEG: walk the marker segments until a Start-Of-Frame marker.
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = data[offset + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = data.readUInt16BE(offset + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      }
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}
