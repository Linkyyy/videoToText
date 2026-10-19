import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Next.js already provides Sharp for its image pipeline.
const require = createRequire(import.meta.resolve("next/package.json"));
const sharp = require("sharp");
const svg = await readFile(new URL("../src/app/icon.svg", import.meta.url));
const publicDir = new URL("../public/icons/", import.meta.url);
await mkdir(publicDir, { recursive: true });
for (const size of [192, 512]) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(new URL(`icon-${size}.png`, publicDir).pathname);
}
await sharp(svg)
  .resize(180, 180)
  .png()
  .toFile(new URL("../src/app/apple-icon.png", import.meta.url).pathname);
// A full-bleed background prevents a second rounded mask on installed launchers.
const maskable = svg
  .toString()
  .replace('rx="112"', 'rx="0"')
  .replace('rx="111"', 'rx="0"');
await sharp(Buffer.from(maskable))
  .resize(512, 512)
  .png()
  .toFile(new URL("icon-maskable-512.png", publicDir).pathname);

const sizes = [16, 32, 48];
const pngs = await Promise.all(
  sizes.map((size) => sharp(svg).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const at = 6 + index * 16;
  header[at] = header[at + 1] = size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(pngs[index].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += pngs[index].length;
});
await writeFile(
  new URL("../src/app/favicon.ico", import.meta.url),
  Buffer.concat([header, ...pngs]),
);
console.log(
  "Generated favicon, Apple touch icon and installable application icons.",
);
