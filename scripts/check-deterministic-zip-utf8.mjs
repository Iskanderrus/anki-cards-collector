/**
 * Regression for ACCP023-REV-F4: UTF-8 filenames must set ZIP EFS (bit 11)
 * in both the local file header and the central-directory header.
 *
 * Pure Node parser — no extra ZIP dependencies.
 */
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildDeterministicZip } from "./deterministic-zip.mjs";

const UTF8_EFS = 0x0800;
const FILENAME = "café.txt";
const PAYLOAD = Buffer.from("unicode-payload-roundtrip\n", "utf8");

const archive = buildDeterministicZip([{ name: FILENAME, data: PAYLOAD }]);

assert.equal(archive.readUInt32LE(0), 0x04034b50, "local file header signature");
const localFlags = archive.readUInt16LE(6);
const localNameLen = archive.readUInt16LE(26);
const localExtraLen = archive.readUInt16LE(28);
const localCompSize = archive.readUInt32LE(18);
const localName = archive.subarray(30, 30 + localNameLen).toString("utf8");
const localDataStart = 30 + localNameLen + localExtraLen;
const localCompressed = archive.subarray(localDataStart, localDataStart + localCompSize);

assert.equal(localFlags & UTF8_EFS, UTF8_EFS, `local header must set EFS; flags=0x${localFlags.toString(16)}`);
assert.equal(localName, FILENAME, "local header filename must decode as UTF-8 café.txt");
assert.deepEqual(
  Buffer.from(localName, "utf8"),
  Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9, 0x2e, 0x74, 0x78, 0x74]),
  "filename bytes must be the UTF-8 encoding of café.txt",
);

const centralOffset = localDataStart + localCompSize;
assert.equal(archive.readUInt32LE(centralOffset), 0x02014b50, "central directory signature");
const centralFlags = archive.readUInt16LE(centralOffset + 8);
const centralNameLen = archive.readUInt16LE(centralOffset + 28);
const centralName = archive.subarray(
  centralOffset + 46,
  centralOffset + 46 + centralNameLen,
).toString("utf8");

assert.equal(centralFlags & UTF8_EFS, UTF8_EFS, `central header must set EFS; flags=0x${centralFlags.toString(16)}`);
assert.equal(centralFlags, localFlags, "local and central flag words must match");
assert.equal(centralName, FILENAME, "central directory filename must decode as UTF-8 café.txt");

const inflated = inflateRawSync(localCompressed);
assert.deepEqual(inflated, PAYLOAD, "payload must round-trip exactly");

console.log("Deterministic ZIP UTF-8/EFS regression passed.");
console.log(`UNICODE_TEST_FILENAME=${FILENAME}`);
console.log(`LOCAL_HEADER_FLAGS=0x${localFlags.toString(16).padStart(4, "0")}`);
console.log(`CENTRAL_HEADER_FLAGS=0x${centralFlags.toString(16).padStart(4, "0")}`);
console.log("UTF8_FLAG_LOCAL=PASS");
console.log("UTF8_FLAG_CENTRAL=PASS");
console.log("UNICODE_FILENAME_ROUNDTRIP=PASS");
console.log("UNICODE_PAYLOAD_ROUNDTRIP=PASS");
