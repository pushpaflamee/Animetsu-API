// src/db/v2.js
// Separate Mongoose connection for anime_v2 database.
// Import this instead of the default mongoose connection for v2 models.

const mongoose = require('mongoose');

const v2URI = process.env.MONGODB_URI_NEW || 'mongodb://127.0.0.1:27017/anime_v2';

const v2Connection = mongoose.createConnection(v2URI, {
  maxPoolSize: 10,
});

v2Connection.on('connected', () => console.log('[v2] anime_v2 DB connected'));
v2Connection.on('error',     (err) => console.error('[v2] anime_v2 DB error:', err));

module.exports = v2Connection;