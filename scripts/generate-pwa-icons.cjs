/**
 * One-shot: generates PWA icons in public/icons/.
 * Run: node scripts/generate-pwa-icons.cjs
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'icons');
const BG = { r: 139, g: 111, b: 71 }; // #8B6F47 — matches globals.css gradient base

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const sizes = [
    [192, 'icon-192.png'],
    [512, 'icon-512.png'],
    [180, 'apple-touch-icon.png'],
  ];
  for (const [size, filename] of sizes) {
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background: BG,
      },
    })
      .png()
      .toFile(path.join(OUT, filename));
  }
  console.log('Wrote icons to', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
