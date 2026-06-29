// Bundles the whole app into one self-contained, offline HTML file.
// Run with: npm run build  →  produces onceover-standalone.html
// The engine and the sample CSV are inlined so it works from file:// with
// no server and no network (great for opening straight on a phone).
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, 'public');
let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const engine = fs.readFileSync(path.join(pub, 'profile.js'), 'utf8');
const auth = fs.readFileSync(path.join(pub, 'app-auth.js'), 'utf8');
const sample = fs.readFileSync(path.join(pub, 'sample.csv'), 'utf8');

// 1) inline the engine + account layer (replace the external <script src>s).
//    The account layer self-disables when /api/* is unreachable (file://),
//    so the bundle stays a pure offline tool.
html = html.replace('<script src="/profile.js"></script>', '<script>\n' + engine + '\n</script>');
html = html.replace('<script src="/app-auth.js"></script>', '<script>\n' + auth + '\n</script>');

// 2) inline the sample CSV as a global so "Try it" works with no server
html = html.replace('</head>',
  '<script>window.__SAMPLE_CSV__ = ' + JSON.stringify(sample) + ';</script>\n</head>');

// 3) point loadSample at the embedded sample instead of fetch()
html = html.replace(
  "fetch('/sample.csv').then(function(r){return r.text();}).then(handleText);",
  'handleText(window.__SAMPLE_CSV__);'
);

// 4) drop server-only asset refs so there are no 404s in a single file
html = html.replace(/<link rel="icon"[^>]*>\n?/, '');
html = html.replace(/<meta property="og:image"[^>]*>\n?/, '');

// sanity checks — fail loudly rather than ship a broken bundle
if (html.includes('src="/profile.js"')) throw new Error('engine was not inlined');
if (html.includes('src="/app-auth.js"')) throw new Error('account layer was not inlined');
if (html.includes("fetch('/sample.csv')")) throw new Error('sample was not inlined');

const out = path.join(__dirname, 'onceover-standalone.html');
fs.writeFileSync(out, html);
console.log('Built ' + path.basename(out) + ' (' + (html.length / 1024).toFixed(1) + ' KB) — open it on any device, no server needed.');
