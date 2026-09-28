import { crc32, deflateRawSync } from "node:zlib";

/** Fixed Unix epoch used for every ZIP entry (2000-01-01T00:00:00Z). */
export const PACKAGE_SOURCE_DATE_EPOCH = 946684800;

/** Regular file mode rw-r--r--; ignores host umask and source modes. */
const FIXED_FILE_MODE = 0o100644;

/**
 * Build a deterministic ZIP archive.
 *
 * Semantics are fully source-defined: fixed UTC timestamps, fixed Unix modes,
 * sorted entry order, no extra fields, and zlib raw deflate at a pinned level.
 * Host `SOURCE_DATE_EPOCH`, file mtimes, and umask do not affect the bytes.
 *
 * @param {Array<{ name: string, data: Buffer }>} entries
 * @returns {Buffer}
 */
export function buildDeterministicZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const { time: dosTime, date: dosDate } = toDosDateTime(PACKAGE_SOURCE_DATE_EPOCH);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of sorted) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const checksum = crc32(data) >>> 0;
    const compressed = deflateRawSync(data, { level: 9 });
    const compressionMethod = 8;
    const versionNeeded = 20;
    const flags = 0;
    const externalAttrs = (((FIXED_FILE_MODE & 0xffff) * 65536) >>> 0);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(versionNeeded, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 * 256) + 20, 4); // Unix + ZIP 2.0
    centralHeader.writeUInt16LE(versionNeeded, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(externalAttrs, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function toDosDateTime(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);
  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}
