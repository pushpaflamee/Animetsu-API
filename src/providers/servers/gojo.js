// src/providers/servers/gojo.js
const axios       = require('axios');
const cheerio     = require('cheerio');
const StreamCache = require('../../models/StreamCache');

const SERVER_ID    = 'gojo';
const MAPPER_BASE  = 'https://mapper.mewcdn.online/api/mal';
const DECODER_BASE = 'https://anikoto.net/ajax/server?get=';
const USER_AGENT   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// --- Anti-Scrape Bypass: Host Map ---
const HOST_MAP = {
    'vault-10.owocdn.top': '10.bigdreamsmalldih.site',
    'vault-11.owocdn.top': '11.bigdreamsmalldih.site',
    'vault-12.owocdn.top': '12.bigdreamsmalldih.site',
    'vault-13.owocdn.top': '13.bigdreamsmalldih.site',
    'vault-14.owocdn.top': '14.bigdreamsmalldih.site',
    'vault-15.owocdn.top': '15.bigdreamsmalldih.site',
    'vault-16.owocdn.top': '16.bigdreamsmalldih.site',
    'vault-99.owocdn.top': '99.bigdreamsmalldih.site',
    'vault-01.uwucdn.top': 'uwu1.bigdreamsmalldih.site',
    'vault-02.uwucdn.top': 'uwu2.bigdreamsmalldih.site',
    'vault-03.uwucdn.top': 'uwu3.bigdreamsmalldih.site',
    'vault-04.uwucdn.top': 'uwu4.bigdreamsmalldih.site',
    'vault-05.uwucdn.top': 'uwu5.bigdreamsmalldih.site',
    'vibeplayer.site': 'nanobyte.bigdreamsmalldih.site',
    'vault-06.uwucdn.top': 'uwu6.bigdreamsmalldih.site',
    'vault-07.uwucdn.top': 'uwu7.bigdreamsmalldih.site',
    'vault-08.uwucdn.top': 'uwu8.bigdreamsmalldih.site',
    'vault-09.uwucdn.top': 'uwu9.bigdreamsmalldih.site',
    'vault-10.uwucdn.top': 'uwu10.bigdreamsmalldih.site',
    'vault-11.uwucdn.top': 'uwu11.bigdreamsmalldih.site',
    'vault-12.uwucdn.top': 'uwu12.bigdreamsmalldih.site',
    'vault-13.uwucdn.top': 'uwu13.bigdreamsmalldih.site',
    'vault-14.uwucdn.top': 'uwu14.bigdreamsmalldih.site',
    'vault-15.uwucdn.top': 'uwu15.bigdreamsmalldih.site',
    'vault-16.uwucdn.top': 'uwu16.bigdreamsmalldih.site',
    'vault-99.uwucdn.top': 'uwu17.bigdreamsmalldih.site',
};

function applyHostMap(url) {
  if (!url || typeof url !== 'string') return url;
  let out = url;
  for (const origin in HOST_MAP) {
      if (out.includes(origin)) {
          out = out.split(origin).join(HOST_MAP[origin]);
      }
  }
  return out;
}

function parseExpiresIn(str) {
  if (!str || typeof str !== 'string') return 60 * 60 * 1000;
  let ms = 0;
  const h = str.match(/(\d+)\s*hour/);
  const m = str.match(/(\d+)\s*minute/);
  const s = str.match(/(\d+)\s*second/);
  if (h) ms += parseInt(h[1]) * 3600 * 1000;
  if (m) ms += parseInt(m[1]) * 60   * 1000;
  if (s) ms += parseInt(s[1])        * 1000;
  return ms || 60 * 60 * 1000;
}

// --- Kwik Extractor Logic ---
function substringAfterLast(str, pattern) {
  return str.split(pattern).pop() || "";
}

class UnBase {
  constructor(radix) {
    this.radix = radix;
    this.dictionary = {};
    const alpha62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const alpha95 = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    if (radix > 36) {
      if (radix < 62) this.alphabet = alpha62.substring(0, radix);
      else if (radix === 62) this.alphabet = alpha62;
      else if (radix < 95) this.alphabet = alpha95.substring(0, radix);
      else if (radix === 95) this.alphabet = alpha95;
      for (let i = 0; i < this.alphabet.length; i++) {
        this.dictionary[this.alphabet.charAt(i)] = i;
      }
    } else {
      this.alphabet = "";
    }
  }
  unBase(str) {
    if (this.alphabet === "") return parseInt(str, this.radix);
    let ret = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charAt(str.length - 1 - i);
      const value = this.dictionary[char];
      if (value !== undefined) ret += Math.pow(this.radix, i) * value;
    }
    return ret;
  }
}

function unpackJsAndCombine(packedJS) {
  try {
    const exp = /\}\s*\('(.*)',\s*(.*?),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/s;
    const matches = exp.exec(packedJS);
    if (!matches || matches.length !== 5) return null;
    let payload = matches[1].replace(/\\'/g, "'");
    const radix = parseInt(matches[2], 10) || 36;
    const count = parseInt(matches[3], 10) || 0;
    const symArray = matches[4].split("|");
    const unBase = new UnBase(radix);
    payload = payload.replace(/\b\w+\b/g, (word) => {
      const index = unBase.unBase(word);
      return (index < symArray.length && symArray[index]) ? symArray[index] : word;
    });
    return payload;
  } catch { return null; }
}

async function extractDirect(kwikLink) {
  try {
    const { data: body } = await axios.get(kwikLink, { 
      headers: { Referer: 'https://anikoto.net/', "User-Agent": USER_AGENT },
      timeout: 8000
    });
    const $ = cheerio.load(body);
    let packedScript = "";
    $("script").each((_, el) => {
      const content = $(el).html() || "";
      if (content.includes("eval(function")) packedScript = content;
    });
    
    if (!packedScript) return kwikLink; 
    
    const scriptPart = substringAfterLast(packedScript, "eval(function(");
    const unpacked = unpackJsAndCombine("eval(function(" + scriptPart);
    if (!unpacked) return kwikLink;

    const m3u8Match = unpacked.match(/https?:\/\/[^'"]+\.m3u8/i);
    if (m3u8Match) {
      return applyHostMap(m3u8Match[0]);
    }
    return kwikLink;
  } catch (err) {
    return kwikLink;
  }
}
// ----------------------------

async function decodeUrl(encryptedStr) {
  const decoderUrl = `${DECODER_BASE}${encryptedStr}`;
  try {
    const { data } = await axios.get(decoderUrl, {
      timeout: 8000,
      headers: { 
        'User-Agent': USER_AGENT,
        'Origin': 'https://anikoto.net',
        'Referer': 'https://anikoto.net/',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      }
    });
    
    let finalUrl = data?.result?.url || data?.url || data?.source || null;
    let embedUrl = finalUrl; 
    
    // --- Bypass Step 1: Base64 decode from Plyr Hash ---
    if (finalUrl && finalUrl.includes('plyr.php#')) {
      try {
        const hashFragments = finalUrl.split('#');
        if (hashFragments.length > 1 && hashFragments[1]) {
          const decodedBase64 = Buffer.from(hashFragments[1], 'base64').toString('utf-8');
          finalUrl = applyHostMap(decodedBase64);
        }
      } catch (e) {
        console.error('[Gojo Decoder] Base64 decode failed for plyr hash', e.message);
      }
    } 
    // Fallback for older /e/ endpoints
    else if (finalUrl && finalUrl.includes('/e/')) {
      finalUrl = await extractDirect(finalUrl);
      finalUrl = applyHostMap(finalUrl);
    } 
    // Just apply HostMap if it's already a direct link
    else if (finalUrl) {
      finalUrl = applyHostMap(finalUrl);
    }
    
    return { url: finalUrl, embedUrl };
  } catch (err) {
    return { url: null, embedUrl: null };
  }
}

async function fetchAndDecode(malId, epNum) {
  const timestamp = Math.floor(Date.now() / 1000);
  const mapperUrl = `${MAPPER_BASE}/${malId}/${epNum}/${timestamp}`;
  
  let raw;
  try {
    const { data } = await axios.get(mapperUrl, {
      timeout: 10000,
      headers: { 'User-Agent': USER_AGENT }
    });
    raw = data;
  } catch (err) {
    return { streams: [], expiresAt: new Date(Date.now() + 3600000) };
  }

  const statusBlock  = raw.status || {};
  const expiresInStr = statusBlock.cache_expires_in || '';
  const expiresInMs  = parseExpiresIn(expiresInStr);
  const expiresAt    = new Date(Date.now() + expiresInMs);

  const jobs = [];
  for (const [label, value] of Object.entries(raw)) {
    if (label === 'status') continue;
    if (typeof value !== 'object') continue;
    for (const [type, typeData] of Object.entries(value)) {
      if (typeData?.url && typeof typeData.url === 'string') {
        jobs.push({ label, type, encUrl: typeData.url });
      }
    }
  }

  if (!jobs.length) {
    return { streams: [], expiresAt };
  }

  const decoded = await Promise.all(
    jobs.map(async job => {
      const { url, embedUrl } = await decodeUrl(job.encUrl);
      return { label: job.label, type: job.type, url, embedUrl };
    })
  );

  const streams = decoded.filter(d => d.url).map(d => ({ 
    label: d.label, 
    type: d.type, 
    url: d.url, 
    embedUrl: d.embedUrl 
  }));

  return { streams, expiresAt };
}

async function getStreams(malId, epNum) {
  const now = new Date();
  const cached = await StreamCache.findOne({
    server: SERVER_ID,
    mal_id: malId,
    ep_num: epNum
  }).lean();

  if (cached && cached.expires_at > now && cached.streams && cached.streams.length > 0) {
    const hasBadCache = cached.streams.some(s => s.url.includes('/e/'));
    if (!hasBadCache) {
      return { streams: cached.streams, fromCache: true };
    }
  }

  const { streams, expiresAt } = await fetchAndDecode(malId, epNum);

  if (streams.length > 0) {
    await StreamCache.findOneAndUpdate(
      { server: SERVER_ID, mal_id: malId, ep_num: epNum },
      { $set: { streams, expires_at: expiresAt } },
      { upsert: true, new: true }
    );
  }

  return { streams, fromCache: false };
}

async function checkAvailability(animeDoc, epNum) {
  if (!animeDoc.mal_id) return { available: false };
  try {
    const result = await getStreams(animeDoc.mal_id, epNum);
    return { available: (result.streams?.length > 0) };
  } catch (err) {
    return { available: false };
  }
}

function extractQuality(label) {
  if (label.includes('1080p')) return '1080p';
  if (label.includes('720p')) return '720p';
  if (label.includes('480p')) return '480p';
  if (label.includes('360p')) return '360p';
  return 'default';
}

async function getSources(animeDoc, epNum, sourceType) {
  if (!animeDoc.mal_id) throw new Error('No MAL ID available');

  const result = await getStreams(animeDoc.mal_id, epNum);
  const streams = result.streams || [];
  const filtered = streams.filter(s => s.type === sourceType);

  if (filtered.length === 0) {
    throw new Error(`No ${sourceType} sources found for server ${SERVER_ID}`);
  }

  return filtered.map(s => {
    // --- Bypass Step 3: Flag streams that require byte stripping ---
    const needsStrip = /ibyteimg\.com|tiktokcdn\.com/i.test(s.url);
    
    return {
      quality: extractQuality(s.label),
      raw_url: s.url,
      embed_url: s.embedUrl,
      old_hls: true,
      type: 'video/mpegurl',
      requires_byte_stripping: needsStrip, // Proxy or front-end must check this
      strip_bytes: needsStrip ? 252 : 0
    };
  });
}

module.exports = { checkAvailability, getStreams, getSources, SERVER_ID };