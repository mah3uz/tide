import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const dir = fileURLToPath(new URL('../static/brand/', import.meta.url));
const source = readFileSync(dir + 'app-icon.svg', 'utf8');

function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

// Full-bleed square with the artwork at 80%, so launchers can crop any mask shape.
function bleed(size) {
  const inner = source.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return render(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#07140f"/><g transform="translate(51.2 51.2) scale(0.8)">${inner}</g></svg>`,
    size
  );
}

const out = {
  'icon-192.png': render(source, 192),
  'icon-512.png': render(source, 512),
  'icon-maskable-512.png': bleed(512),
  'apple-touch-icon.png': bleed(180),
  'favicon-32.png': render(source, 32)
};
for (const [name, png] of Object.entries(out)) writeFileSync(dir + name, png);
