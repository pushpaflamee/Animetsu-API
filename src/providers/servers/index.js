// src/providers/servers/index.js
const gojo     = require('./gojo');
const animepahe = require('./animepahe');
const kite     = require('./kite');


// Server registry
const REGISTRY = [
  { provider: gojo,      id: 'gojo',   tip: 'Hard sub, Multi quality' },
  { provider: animepahe, id: 'pahe',   tip: 'Hard sub, Fast, Multi quality' },
  { provider: kite,      id: 'kite',   tip: 'Soft sub, Multi quality' },
];

async function getAvailableServers(animeDoc, epNum) {
  const results = await Promise.allSettled(
    REGISTRY.map(entry => entry.provider.checkAvailability(animeDoc, epNum))
  );

  const available = [];
  const debugInfo = {};

  for (let i = 0; i < REGISTRY.length; i++) {
    const result = results[i];
    const providerId = REGISTRY[i].id;

    if (result.status === 'fulfilled') {
      const check = result.value;
      const isAvailable = typeof check === 'object' ? check.available : (check === true);

      if (isAvailable) {
        available.push({
          id:      providerId,
          default: available.length === 0,
          tip:     REGISTRY[i].tip
        });
      } else {
        // --- UPDATE THIS BLOCK ---
        debugInfo[providerId] = typeof check === 'object' ? {
          error: check.error,
          urls: check.debugUrls,
          rawResponse: check.rawResponse,
          decoderResponses: check.decoderResponses,
          fromCache: check.fromCache
        } : 'Stream check returned false';
        // -------------------------
      }
    } else {
      debugInfo[providerId] = result.reason?.message || 'Provider check promise rejected';
    }
  }

  return { available, debugInfo };
}

async function getSources(serverId, animeDoc, epNum, sourceType) {
  const entry = REGISTRY.find(r => r.id === serverId);
  if (!entry) throw new Error(`Server '${serverId}' not found or unsupported`);

  if (typeof entry.provider.getSources !== 'function') {
    throw new Error(`Provider '${serverId}' does not implement getSources`);
  }

  return entry.provider.getSources(animeDoc, epNum, sourceType);
}

// Update the exports at the bottom:
module.exports = { getAvailableServers, getSources };