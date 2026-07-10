// Generates PNG app icons from public/icon.svg.
// Requires the optional "sharp" package:  npm i -D sharp
// Then run:  npm run gen:icons
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('\n[gen:icons] The "sharp" package is not installed.');
  console.error('Install it first:  npm i -D sharp\n');
  console.error('(The app still installs as a PWA using icon.svg without PNGs,');
  console.error(' but iPhone "Add to Home Screen" looks best with the PNG icons.)\n');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(join(root, 'public', 'icon.svg'));
const outDir = join(root, 'public', 'icons');
await mkdir(outDir, { recursive: true });

for (const size of [192, 512]) {
  const out = join(outDir, `icon-${size}.png`);
  await sharp(svg).resize(size, size).png().toFile(out);
  console.log('wrote', out);
}
console.log('Done.');
