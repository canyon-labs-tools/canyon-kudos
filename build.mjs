// Build step for production.
//
// index.html is the source: open it as-is and the browser compiles the app
// with Babel, which is fine for local work. For production this script does that
// compile once, ahead of time, so visitors' browsers don't have to:
//   - the JSX in the <script type="text/babel"> block becomes plain, minified
//     JavaScript in dist/app.<hash>.js (the hash changes when the code does,
//     so it can be cached for a year)
//   - the Babel script tag is dropped
//   - React, React DOM and Supabase load with `defer`, so they don't hold up
//     the first paint
// Images are copied as-is. server.js serves dist/ when it exists.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { transform } from 'esbuild';

const OUT = 'dist';
const html = readFileSync('index.html', 'utf8');

const open = '<script type="text/babel" data-type="module" data-presets="react">';
const start = html.indexOf(open);
const end = html.indexOf('</script>', start);
if (start < 0 || end < 0 || html.indexOf(open, start + 1) >= 0) {
  throw new Error('expected exactly one text/babel script block in index.html');
}
const jsx = html.slice(start + open.length, end);

const { code } = await transform(jsx, {
  loader: 'jsx',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  // Babel ran it as a module (data-type="module"); keep it out of global scope.
  format: 'iife',
  target: 'es2019',
  minify: true,
  legalComments: 'none',
});
const name = `app.${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`;

const babelTag = /\s*<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/babel-standalone\/[^"]+"><\/script>/;
if (!babelTag.test(html)) throw new Error('Babel script tag not found in index.html');

let out = html.slice(0, start) + `<script src="${name}" defer></script>` + html.slice(end + '</script>'.length);
out = out.replace(babelTag, '');
for (const lib of ['react.production.min.js', 'react-dom.production.min.js', 'supabase.min.js']) {
  const tag = new RegExp(`<script src="([^"]+/${lib.replace(/\./g, '\\.')})"></script>`);
  if (!tag.test(out)) throw new Error(`script tag for ${lib} not found in index.html`);
  out = out.replace(tag, '<script src="$1" defer></script>');
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
writeFileSync(`${OUT}/${name}`, code);
writeFileSync(`${OUT}/index.html`, out);
for (const f of readdirSync('.')) {
  if (/\.(png|svg|ico|jpg|webp)$/i.test(f)) cpSync(f, `${OUT}/${f}`);
}
console.log(`built ${OUT}/index.html + ${OUT}/${name} (${(code.length / 1024).toFixed(0)} KB)`);
