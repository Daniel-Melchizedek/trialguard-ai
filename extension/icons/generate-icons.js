const sharp = require('sharp');
const path = require('path');

const svgSource = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <path d="M64 8 L116 28 L116 68 Q116 104 64 122 Q12 104 12 68 L12 28 Z"
        fill="#2563EB"/>
  <circle cx="64" cy="64" r="30" fill="white"/>
  <line x1="64" y1="64" x2="46" y2="46"
        stroke="#2563EB" stroke-width="7" stroke-linecap="round"/>
  <line x1="64" y1="64" x2="64" y2="38"
        stroke="#2563EB" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="64" r="4" fill="#2563EB"/>
</svg>
`;

const sizes = [16, 48, 128];

async function generate() {
  for (const size of sizes) {
    const outPath = path.join(__dirname, `icon${size}.png`);
    await sharp(Buffer.from(svgSource))
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`Written: icon${size}.png (${size}x${size})`);
  }
}

generate().catch(err => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
