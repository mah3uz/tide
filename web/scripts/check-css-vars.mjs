// CSS does not error on an undefined custom property: the declaration just
// silently drops. This fails the build on any var(--x) that has no fallback and
// no definition anywhere in web/src.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(css|svelte|ts)$/.test(e.name)) files.push(p);
  }
})(root);

const defined = new Set();
const uses = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)) defined.add(m[1]);
  for (const m of text.matchAll(/style:(--[\w-]+)/g)) defined.add(m[1]);
  for (const m of text.matchAll(/['"`](--[\w-]+)['"`]\s*[,)]/g)) defined.add(m[1]);
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    if (m[2] === ')') {
      const line = text.slice(0, m.index).split('\n').length;
      uses.push({ name: m[1], where: `${file.slice(root.length - 3)}:${line}` });
    }
  }
}

const missing = uses.filter((u) => !defined.has(u.name));
if (missing.length) {
  console.error('var(--x) with no fallback and no definition:');
  for (const u of missing) console.error(`  ${u.name}  ${u.where}`);
  process.exit(1);
}
console.log(`css vars ok: ${uses.length} fallback-less uses, all defined`);
