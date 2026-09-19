import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const VARIANTS = [
  {
    size: 16,
    source: "assets/brand/source/collector-single.png",
    output: "icon16.png",
  },
  {
    size: 32,
    source: "assets/brand/source/collector-single.png",
    output: "icon32.png",
  },
  {
    size: 48,
    source: "assets/brand/source/collector-multi.png",
    output: "icon48.png",
  },
  {
    size: 128,
    source: "assets/brand/source/collector-multi.png",
    output: "icon128.png",
  },
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function decodeRgbaPng(buffer) {
  assert.ok(
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    "Brand source must be a PNG.",
  );

  let offset = PNG_SIGNATURE.length;
  let width;
  let height;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "Brand source must use 8-bit channels.");
      assert.equal(data[9], 6, "Brand source must be RGBA (PNG color type 6).");
      assert.equal(data[12], 0, "Interlaced PNG sources are not supported.");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  assert.ok(width && height, "PNG is missing IHDR dimensions.");
  assert.equal(width, height, "Brand source must be square.");
  assert.ok(width >= 128, "Brand source must be at least 128x128.");

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(
    raw.length,
    height * (stride + 1),
    "Unexpected PNG scanline length.",
  );

  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const filtered = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    const row = Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x] ?? 0;
      const upLeft =
        x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      const value = filtered[x];

      if (filter === 0) row[x] = value;
      else if (filter === 1) row[x] = (value + left) & 0xff;
      else if (filter === 2) row[x] = (value + up) & 0xff;
      else if (filter === 3) {
        row[x] = (value + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor =
          pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (value + predictor) & 0xff;
      } else {
        throw new Error(`Unsupported PNG filter ${filter}.`);
      }
    }

    row.copy(pixels, y * stride);
    previous = row;
  }

  return { width, height, pixels };
}

function samplePremultiplied(image, x, y) {
  const clampedX = Math.max(0, Math.min(image.width - 1, x));
  const clampedY = Math.max(0, Math.min(image.height - 1, y));
  const index = (clampedY * image.width + clampedX) * 4;
  const alpha = image.pixels[index + 3] / 255;

  return [
    image.pixels[index] * alpha,
    image.pixels[index + 1] * alpha,
    image.pixels[index + 2] * alpha,
    alpha,
  ];
}

function resizeSquare(image, size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scaleX = image.width / size;
  const scaleY = image.height / size;

  for (let y = 0; y < size; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.floor(sourceY);
    const y1 = y0 + 1;
    const fy = sourceY - y0;

    for (let x = 0; x < size; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.floor(sourceX);
      const x1 = x0 + 1;
      const fx = sourceX - x0;

      const samples = [
        [samplePremultiplied(image, x0, y0), (1 - fx) * (1 - fy)],
        [samplePremultiplied(image, x1, y0), fx * (1 - fy)],
        [samplePremultiplied(image, x0, y1), (1 - fx) * fy],
        [samplePremultiplied(image, x1, y1), fx * fy],
      ];

      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (const [sample, weight] of samples) {
        red += sample[0] * weight;
        green += sample[1] * weight;
        blue += sample[2] * weight;
        alpha += sample[3] * weight;
      }

      const index = (y * size + x) * 4;
      const clampedAlpha = Math.max(0, Math.min(1, alpha));
      pixels[index + 3] = Math.round(clampedAlpha * 255);

      if (clampedAlpha > 0) {
        pixels[index] = Math.round(
          Math.max(0, Math.min(255, red / clampedAlpha)),
        );
        pixels[index + 1] = Math.round(
          Math.max(0, Math.min(255, green / clampedAlpha)),
        );
        pixels[index + 2] = Math.round(
          Math.max(0, Math.min(255, blue / clampedAlpha)),
        );
      }
    }
  }

  return { width: size, height: size, pixels };
}

function encodeRgbaPng(image) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const stride = image.width * 4;
  const raw = Buffer.alloc(image.height * (stride + 1));

  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    image.pixels.copy(
      raw,
      rowStart + 1,
      y * stride,
      (y + 1) * stride,
    );
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function generateBrandIcons(outputDirectory) {
  const sourceCache = new Map();
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });

  for (const variant of VARIANTS) {
    let source = sourceCache.get(variant.source);
    if (!source) {
      source = decodeRgbaPng(await readFile(resolve(variant.source)));
      sourceCache.set(variant.source, source);
    }

    const icon = encodeRgbaPng(resizeSquare(source, variant.size));
    await writeFile(resolve(output, variant.output), icon);
  }
}

const cliPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === cliPath) {
  const outputDirectory = process.argv[2] ?? "dist/icons";
  await generateBrandIcons(outputDirectory);
  console.log(`Generated Collector brand icons in ${outputDirectory}`);
}
