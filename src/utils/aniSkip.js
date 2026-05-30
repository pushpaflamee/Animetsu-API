// src/utils/aniSkip.js
const axios = require('axios');

async function getSkips(malId, epNum) {
  const defaultSkips = { ep_num: Number(epNum) };
  if (!malId) return defaultSkips;

  try {
    const { data } = await axios.get(`https://api.aniskip.com/v2/skip-times/${malId}/${epNum}?types=op&types=ed&episodeLength=0`, {
      timeout: 5000
    });

    if (data.found) {
      const op = data.results.find(r => r.skipType === 'op');
      const ed = data.results.find(r => r.skipType === 'ed');

      if (op) {
        defaultSkips.intro = { start: op.interval.startTime, end: op.interval.endTime };
      }
      if (ed) {
        defaultSkips.outro = { start: ed.interval.startTime, end: ed.interval.endTime };
      }
    }
  } catch (err) {
    // Fail silently if AniSkip is down or doesn't have data for this episode
  }

  return defaultSkips;
}

module.exports = { getSkips };