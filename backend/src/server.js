'use strict';

const { createApp } = require('./app');

const port = Number(process.env.PORT || 12024);
const host = process.env.HOST || '127.0.0.1';

createApp().listen(port, host, () => {
  console.log(JSON.stringify({ ok: true, service: 'code_lounge_backend', url: `http://${host}:${port}` }));
});
