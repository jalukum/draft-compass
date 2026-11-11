// Draws the Draft Compass icon (original artwork) and writes PNG sizes.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const mark = (pad) => `
  <g transform="translate(${pad} ${pad}) scale(${(512 - pad * 2) / 512})">
    <circle cx="256" cy="256" r="224" fill="#ffd21f" stroke="#0d0b26" stroke-width="36"/>
    <circle cx="256" cy="256" r="150" fill="#14123a"/>
    <g stroke="#0d0b26" stroke-width="22" stroke-linejoin="round">
      <path d="M256 82 L314 256 L256 430 L198 256 Z" fill="#ff3d7f"/>
      <path d="M256 82 L314 256 L198 256 Z" fill="#2ad4ff"/>
    </g>
    <circle cx="256" cy="256" r="30" fill="#fff8e6" stroke="#0d0b26" stroke-width="16"/>
    <g fill="#0d0b26"><rect x="244" y="14" width="24" height="46" rx="8"/><rect x="244" y="452" width="24" height="46" rx="8"/>
    <rect x="14" y="244" width="46" height="24" rx="8"/><rect x="452" y="244" width="46" height="24" rx="8"/></g>
  </g>`;
const dots = Array.from({ length: 64 }, (_, i) => `<circle cx="${(i % 8) * 64 + 32}" cy="${Math.floor(i / 8) * 64 + 32}" r="5" fill="#2b2770"/>`).join('');
const full = (pad, bg = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg ? `<rect width="512" height="512" fill="#14123a"/>${dots}` : ''}${mark(pad)}</svg>`;

const out = new URL('../public/icons/', import.meta.url);
writeFileSync(new URL('favicon.svg', out), full(8, false));
const jobs = [
  ['icon-192.png', 192, full(28)], ['icon-512.png', 512, full(28)],
  ['maskable-512.png', 512, full(96)], ['apple-touch-icon.png', 180, full(40)],
];
for (const [name, size, svg] of jobs) await sharp(Buffer.from(svg)).resize(size, size).png().toFile(new URL(name, out).pathname);
console.log('icons written');
