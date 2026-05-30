// src/utils/cache.js
const NodeCache = require('node-cache');
const ttl = Number(process.env.CACHE_TTL_SECONDS) || 300;
module.exports = new NodeCache({ stdTTL: ttl, checkperiod: 60 });