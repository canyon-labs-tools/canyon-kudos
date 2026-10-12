const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const app = express();

// Production serves the prebuilt copy in dist/ (see build.mjs). Without a
// build, it serves the source index.html, which compiles itself in the browser.
const dist = path.join(__dirname, 'dist');
const root = fs.existsSync(path.join(dist, 'index.html')) ? dist : __dirname;

app.use(compression());
app.get('/_health', (_, res) => res.json({ ok: true }));
app.use(express.static(root, {
  extensions: ['html'],
  setHeaders(res, file) {
    const base = path.basename(file);
    if (/^app\.[0-9a-f]{10}\.js$/.test(base)) {
      // The name changes whenever the code does, so it never goes stale.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (base.endsWith('.html')) {
      // Always check for a new page, so a deploy shows up on the next visit.
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));
app.get('*', (_, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(root, 'index.html'));
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kudos listening on ${PORT}`));
