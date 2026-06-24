#!/usr/bin/env node
// Build: bundles index.js, inlines all CSS/JS → dist/index.html

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

const result = await build({
  entryPoints: [resolve(__dir, 'src/index.ts')],
  bundle: true,
  format: 'iife',
  globalName: '_app',
  minify: true,
  write: false,
  platform: 'browser',
  // CodeMirror, marked, hljs loaded as separate globals — keep as-is
  // They're loaded via script tags, not imported
});

const bundledJs = result.outputFiles[0].text;

// Inline helper
const inline = (path) => readFileSync(resolve(__dir, path), 'utf8');

// Libs loaded via script tags (globals, not ES imports)
const libScripts = [
  'lib/codemirror.min.js',
  'lib/cm-xml.min.js',
  'lib/cm-markdown.min.js',
  'lib/cm-javascript.min.js',
  'lib/cm-css.min.js',
  'lib/cm-htmlmixed.min.js',
  'lib/marked.min.js',
  'lib/highlight.min.js',
];

const libCss = [
  'lib/codemirror.min.css',
  'lib/github.min.css',
  'lib/atom-one-dark.min.css',
  'style.css',
];

let html = inline('index.html');

// Remove existing link/script tags for these files
html = html.replace(/<link[^>]+hljs-light[^>]*>/g, '');
html = html.replace(/<link[^>]+hljs-dark[^>]*>/g, '');
html = html.replace(/<link[^>]+codemirror\.min\.css[^>]*>/g, '');
html = html.replace(/<link[^>]+style\.css[^>]*>/g, '');
html = html.replace(/<script[^>]+codemirror\.min\.js[^>]*><\/script>/g, '');
html = html.replace(/<script[^>]+cm-xml\.min\.js[^>]*><\/script>/g, '');
html = html.replace(/<script[^>]+cm-markdown\.min\.js[^>]*><\/script>/g, '');
html = html.replace(/<script[^>]+cm-javascript\.min\.js[^>]*><\/script>/g, '');
html = html.replace(/<script[^>]+cm-css\.min\.js[^>]*><\/script>/g, '');
html = html.replace(/<script[^>]+cm-htmlmixed\.min\.js[^>]*><\/script>/g, '');
html = html.replace(/<script[^>]+marked\.min\.js[^>]*><\/script>/g, '');
html = html.replace(/<script[^>]+highlight\.min\.js[^>]*><\/script>/g, '');
html = html.replace(/<script[^>]+src\/index\.ts[^>]*><\/script>/g, '');

// Build inline CSS block (with hljs light/dark toggle support)
const cssBlock = `<style id="hljs-light" disabled>${inline('lib/github.min.css')}</style>
<style id="hljs-dark">${inline('lib/atom-one-dark.min.css')}</style>
<style>${inline('lib/codemirror.min.css')}</style>
<style>${inline('style.css')}</style>`;

// Build inline JS block
const jsBlock = [
  ...libScripts.map(f => `<script>${inline(f)}</script>`),
  `<script>${bundledJs}</script>`,
].join('\n');

// Use placeholders so bundle content can't corrupt the replacements
html = html.replace('</head>', `__HEAD_INJECT__</head>`);
html = html.replace('</body>', `__BODY_INJECT__</body>`);
html = html.replace('__HEAD_INJECT__', () => cssBlock);
html = html.replace('__BODY_INJECT__', () => jsBlock);

mkdirSync(resolve(__dir, 'docs'), { recursive: true });
writeFileSync(resolve(__dir, 'docs/index.html'), html);
console.log('Built: docs/index.html (' + (html.length / 1024).toFixed(0) + ' KB)');
