const express = require('express');
const path = require('path');
const app = express();
app.get('/_health', (_, res) => res.json({ ok: true }));
app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kudos listening on ${PORT}`));
