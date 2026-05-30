// src/controllers/proxyController.js
// Rewritten for maximum speed — native http/https instead of axios for all streaming,
// proper Range pass-through for instant seeking, minimal overhead per request.
// Includes high-performance streaming byte-stripper for anti-scrape bypasses.

const http  = require('http');
const https = require('https');
const { decode, encode, decodeImage } = require('../utils/cipher');
const { URL }            = require('url');

// ─── Constants ───────────────────────────────────────────────────────────────

const M3U8_CONTENT_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
]);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Persistent keep-alive pools — sockets are reused across requests.
const HTTP_AGENT  = new http.Agent ({
  keepAlive      : true,
  maxSockets     : 1024,
  maxFreeSockets : 256,
  keepAliveMsecs : 30_000,
  timeout        : 8_000,
});
const HTTPS_AGENT = new https.Agent({
  keepAlive      : true,
  maxSockets     : 1024,
  maxFreeSockets : 256,
  keepAliveMsecs : 30_000,
  timeout        : 8_000,
  sessionTimeout : 300,   // re-use TLS sessions → skips TLS handshake on repeat CDN hits
});

const PASSTHROUGH_HEADERS = [
  'content-type', 'content-length', 'content-range',
  'accept-ranges', 'cache-control', 'expires',
  'last-modified', 'etag',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUpstreamHeaders(targetUrl, server) {
  const { hostname } = new URL(targetUrl);
  const h = {
    'User-Agent'     : USER_AGENT,
    'Accept'         : '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest' : 'empty',
    'Sec-Fetch-Mode' : 'cors',
    'Sec-Fetch-Site' : 'cross-site',
  };

if (/bigdreamsmalldih\.site/i.test(hostname)) {
    h['Origin'] = 'https://mewcdn.online'; 
    h['Referer'] = 'https://mewcdn.online/';
  } else if (
    server === 'gojo' || server === 'pahe' ||
    /kwik\.cx|padorupado\.ru|owocdn\.top|uwucdn\.top|pahe\.mewcdn/i.test(hostname)
  ) {
    h['Origin'] = 'https://kwik.cx'; h['Referer'] = 'https://kwik.cx/';
  } else if (
    server === 'kite' ||
    /megaplay\.buzz|playcloud1\.|dotstream\.|streamzone1\.site/i.test(hostname)
  ) {
    h['Origin'] = 'https://megaplay.buzz'; h['Referer'] = 'https://megaplay.buzz/';
  } else if (/anikoto\.net|mapper\.mewcdn/i.test(hostname)) {
    h['Origin'] = 'https://anikoto.net';
  } else if (/workers\.dev/i.test(hostname)) {
    h['Origin'] = 'https://anitaku.to'; h['Referer'] = 'https://anitaku.to/';
  } else if (/hlsxst1|burntburst45\.store/i.test(hostname)) {
    h['Origin'] = 'https://aniwaves.ru'; h['Referer'] = 'https://aniwaves.ru/';
  } else {
    h['Origin'] = `https://${hostname}`; h['Referer'] = `https://${hostname}/`;
  }
  
  return h;
}

function buildProxyUrl(absoluteUrl, server, referer, originParam) {
  const payload = { u: absoluteUrl };
  if (referer) payload.r = referer;
  const encoded = encode(JSON.stringify(payload));
  const qs      = originParam ? `?origin=${encodeURIComponent(originParam)}` : '';
  return `/proxy/oppai/${server}/${encoded}${qs}`;
}

function rewriteM3u8(text, realBaseUrl, server, referer, originParam) {
  return text.split('\n').map(line => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) {
      if (/URI=['"]/i.test(t)) {
        return line.replace(/URI=['"]([^'"]+)['"]/g, (_m, uri) => {
          const abs = new URL(uri, realBaseUrl).href;
          return `URI="${buildProxyUrl(abs, server, referer, originParam)}"`;
        });
      }
      return line;
    }
    return buildProxyUrl(new URL(t, realBaseUrl).href, server, referer, originParam);
  }).join('\n');
}

/** Native HTTP fetch — follows redirects, returns buffered text response + final URL */
function nativeFetch(targetUrl, reqHeaders, signal, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));

    const doRequest = (url, left) => {
      const parsed  = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib     = isHttps ? https : http;

      const req = lib.request({
        hostname : parsed.hostname,
        port     : parsed.port || (isHttps ? 443 : 80),
        path     : parsed.pathname + parsed.search,
        method   : 'GET',
        headers  : reqHeaders,
        agent    : isHttps ? HTTPS_AGENT : HTTP_AGENT,
        timeout  : 8_000,
      }, (res) => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          if (left <= 0) return reject(new Error('Too many redirects'));
          res.resume();
          return doRequest(new URL(res.headers.location, url).href, left - 1);
        }
        const chunks = [];
        res.on('data',  c  => chunks.push(c));
        res.on('end',   () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), finalUrl: url }));
        res.on('error', reject);
      });

      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

      if (signal) {
        const abort = () => { req.destroy(); reject(new Error('aborted')); };
        signal.addEventListener('abort', abort, { once: true });
        req.on('close', () => signal.removeEventListener('abort', abort));
      }
      req.end();
    };

    doRequest(targetUrl, maxRedirects);
  });
}

/** Native HTTP stream — zero-copy pipe with inline chunk-slicing for byte stripping */
function nativeStream(targetUrl, reqHeaders, clientRes, signal, maxRedirects = 10, stripBytes = 0) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));

    const doRequest = (url, left) => {
      const parsed  = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib     = isHttps ? https : http;

      const req = lib.request({
        hostname : parsed.hostname,
        port     : parsed.port || (isHttps ? 443 : 80),
        path     : parsed.pathname + parsed.search,
        method   : 'GET',
        headers  : reqHeaders,
        agent    : isHttps ? HTTPS_AGENT : HTTP_AGENT,
        timeout  : 8_000,
      }, (upstream) => {
        if ([301,302,303,307,308].includes(upstream.statusCode) && upstream.headers.location) {
          if (left <= 0) return reject(new Error('Too many redirects'));
          upstream.resume();
          return doRequest(new URL(upstream.headers.location, url).href, left - 1);
        }

        // Forward safe response headers
        PASSTHROUGH_HEADERS.forEach(h => {
          if (upstream.headers[h]) {
            // Adjust content-length if we are stripping bytes
            if (h === 'content-length' && stripBytes > 0) {
              const newLength = Math.max(0, parseInt(upstream.headers[h], 10) - stripBytes);
              clientRes.setHeader(h, newLength.toString());
            } else {
              clientRes.setHeader(h, upstream.headers[h]);
            }
          }
        });

        // Range headers get messy if we shift bytes, drop them to ensure full segment download
        if (stripBytes > 0) {
          clientRes.removeHeader('Accept-Ranges');
          clientRes.removeHeader('Content-Range');
        } else {
          clientRes.setHeader('Accept-Ranges', 'bytes');
        }
        
        clientRes.setHeader('Access-Control-Allow-Origin', '*');
        clientRes.writeHead(upstream.statusCode);

        // ── Inline Byte Stripper Logic ──
        if (stripBytes > 0) {
          let bytesSkipped = 0;
          upstream.on('data', (chunk) => {
            if (bytesSkipped < stripBytes) {
              const needed = stripBytes - bytesSkipped;
              if (chunk.length <= needed) {
                // Drop the entire chunk, we still need to skip more
                bytesSkipped += chunk.length;
              } else {
                // Drop the prefix of this chunk, write the rest to client
                bytesSkipped += needed;
                clientRes.write(chunk.subarray(needed));
              }
            } else {
              // We've skipped the required bytes, stream directly now
              clientRes.write(chunk);
            }
          });
          
          upstream.on('error', reject);
          clientRes.on('error', () => { upstream.destroy(); resolve(); });
          clientRes.on('close', () => { upstream.destroy(); resolve(); });
          upstream.on('end', () => { clientRes.end(); resolve(); });

        } else {
          // Standard zero-copy pipe
          upstream.pipe(clientRes);
          upstream.on('error',  reject);
          clientRes.on('error', () => { upstream.destroy(); resolve(); });
          clientRes.on('close', () => { upstream.destroy(); resolve(); });
          upstream.on('end',    resolve);
        }
      });

      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

      if (signal) {
        const abort = () => { req.destroy(); reject(new Error('aborted')); };
        signal.addEventListener('abort', abort, { once: true });
        req.on('close', () => signal.removeEventListener('abort', abort));
      }
      req.end();
    };

    doRequest(targetUrl, maxRedirects);
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

exports.streamProxy = async (req, res) => {
  const controller = new AbortController();
  const { signal } = controller;
  let done = false;
  const finish = () => { done = true; };
  req.on('close', () => { if (!done) controller.abort(); });

  // ── HEAD: forward upstream so players get a real Content-Length for seeking ──
  if (req.method === 'HEAD') {
    res.setHeader('Accept-Ranges',               'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const decodedStr = decode(req.params.encoded_url);
      let targetUrl = decodedStr;
      try { const p = JSON.parse(decodedStr); if (p?.u) targetUrl = p.u; } catch {}
      if (targetUrl?.startsWith('http')) {
        const headers = req.params.server === 'hindi1' ? {} : getUpstreamHeaders(targetUrl, req.params.server);
        const parsed  = new URL(targetUrl);
        const isHttps = parsed.protocol === 'https:';
        await new Promise(resolve => {
          const hReq = (isHttps ? https : http).request({
            hostname: parsed.hostname,
            port    : parsed.port || (isHttps ? 443 : 80),
            path    : parsed.pathname + parsed.search,
            method  : 'HEAD',
            headers,
            agent   : isHttps ? HTTPS_AGENT : HTTP_AGENT,
            timeout : 5_000,
          }, hRes => {
            // Apply byte-stripping offset to HEAD requests too
            let contentLength = hRes.headers['content-length'];
            if (contentLength && /ibyteimg\.com|tiktokcdn\.com/i.test(targetUrl)) {
               contentLength = Math.max(0, parseInt(contentLength, 10) - 252).toString();
            }

            if (contentLength) res.setHeader('Content-Length', contentLength);
            if (hRes.headers['accept-ranges']) res.setHeader('Accept-Ranges', hRes.headers['accept-ranges']);
            hRes.resume(); resolve();
          });
          hReq.on('error', resolve);
          hReq.on('timeout', () => { hReq.destroy(); resolve(); });
          hReq.end();
        });
      }
    } catch {}
    finish();
    return res.status(200).end();
  }

  try {
    const { server, encoded_url } = req.params;
    const { origin: originParam } = req.query;

    // ── 1. Decode ─────────────────────────────────────────────────────────────
    const decodedStr = decode(encoded_url);
    if (!decodedStr) return res.status(400).send('Invalid payload');

    let targetUrl = '', payloadReferer = '';

    try {
      const payload = JSON.parse(decodedStr);

      // Synthetic master playlist intercept
      if (payload?.m === true) {
        const { s: sources, c: codecs } = payload;
        let manifest = '#EXTM3U\n';
        sources.forEach(src => {
          let bw = 1_500_000, r = '1280x720';
          if      (src.q?.includes('1080')) { bw = 3_000_000; r = '1920x1080'; }
          else if (src.q?.includes('480'))  { bw =   800_000; r = '854x480'; }
          else if (src.q?.includes('360'))  { bw =   400_000; r = '640x360'; }
          const mp = encode(JSON.stringify({ u: src.u }));
          manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${r},CODECS="${codecs.videoCodec},${codecs.audioCodec}"\n/proxy/oppai/${server}/${mp}\n`;
        });
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        finish();
        return res.send(manifest);
      }

      targetUrl      = payload?.u || decodedStr;
      payloadReferer = payload?.r || '';
    } catch {
      targetUrl = decodedStr;
    }

    if (!targetUrl.startsWith('http')) return res.status(400).send('Invalid URL');

    // ── 2. Build headers ──────────────────────────────────────────────────────
    const headers = server === 'hindi1' ? {} : getUpstreamHeaders(targetUrl, server);
    if (originParam)    headers['Origin']  = originParam;
    if (payloadReferer) headers['Referer'] = payloadReferer;

    // Range / cache negotiation — these are critical for instant seeking
    if (req.headers['range'])             headers['Range']             = req.headers['range'];
    if (req.headers['if-range'])          headers['If-Range']          = req.headers['if-range'];
    if (req.headers['if-none-match'])     headers['If-None-Match']     = req.headers['if-none-match'];
    if (req.headers['if-modified-since']) headers['If-Modified-Since'] = req.headers['if-modified-since'];

    // ── 3. M3U8 or binary ────────────────────────────────────────────────────
    if (targetUrl.toLowerCase().includes('.m3u8')) {
      const { statusCode, headers: upH, body, finalUrl } =
        await nativeFetch(targetUrl, headers, signal);

      const bodyText = body.toString('utf8');
      const ct       = (upH['content-type'] || '').toLowerCase().split(';')[0].trim();

      if (!M3U8_CONTENT_TYPES.has(ct) && !bodyText.trimStart().startsWith('#EXTM3U')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        finish();
        return res.status(statusCode).send(body);
      }

      const processed = rewriteM3u8(bodyText, finalUrl, server, payloadReferer || headers['Referer'], originParam);
      const buf       = Buffer.from(processed, 'utf8');
      res.setHeader('Content-Type',               'application/vnd.apple.mpegurl');
      res.setHeader('Content-Length',              buf.length);
      res.setHeader('Cache-Control',               'no-cache, no-store, must-revalidate');
      res.setHeader('Access-Control-Allow-Origin', '*');
      finish();
      return res.status(statusCode).send(buf);
    }

    // ── 4. Binary Streaming & Byte Stripping ─────────────────────────────────
    // Checks if the URL contains any part of the corrupted domains, including subdomains.
    let stripBytes = 0;
    if (/ibyteimg\.com|tiktokcdn\.com/i.test(targetUrl)) {
      stripBytes = 252;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    await nativeStream(targetUrl, headers, res, signal, 10, stripBytes);
    finish();

  } catch (err) {
    if (err.message === 'aborted' || err.message === 'client disconnected') return;
    console.error('[Proxy Error]', err.message);
    if (!res.headersSent) res.status(502).send('Gateway Error');
    finish();
  }
};

// ─── Master playlist (separate route) ────────────────────────────────────────

exports.getMasterPlaylist = (req, res) => {
  try {
    const { svr, s: sources, c: codecs } = JSON.parse(decode(req.params.payload));
    let manifest = '#EXTM3U\n';
    sources.forEach(src => {
      let bw = 1_500_000, r = '1280x720';
      if      (src.q?.includes('1080')) { bw = 3_000_000; r = '1920x1080'; }
      else if (src.q?.includes('480'))  { bw =   800_000; r = '854x480'; }
      else if (src.q?.includes('360'))  { bw =   400_000; r = '640x360'; }
      const mp = encode(JSON.stringify({ u: src.u }));
      manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${r},CODECS="${codecs.videoCodec},${codecs.audioCodec}"\n/proxy/oppai/${svr}/${mp}\n`;
    });
    res.setHeader('Content-Type',               'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(manifest);
  } catch (err) {
    console.error('[Master Playlist Error]', err);
    res.status(500).send('Error generating playlist');
  }
};

// ─────────────────────────────────────────────────────────────
// GET /img/ep/:encoded_url
// Decrypts the URL and securely proxies the image natively
// ─────────────────────────────────────────────────────────────
exports.episodeImageProxy = async (req, res) => {
  const controller = new AbortController();
  
  try {
    const { encoded_url } = req.params;
    if (!encoded_url) return res.status(400).send('Missing encoded image URL');

    // 1. Decrypt the URL
    const decodedUrl = decodeImage(encoded_url);
    if (!decodedUrl || !decodedUrl.startsWith('http')) {
      return res.status(400).send('Invalid decoded image URL');
    }

    // 2. Set up headers using your global USER_AGENT
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': 'https://thetvdb.com/' 
    };

    // 3. Set caching and CORS headers early
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // 4. Pipe the image natively using your existing high-speed function!
    await nativeStream(decodedUrl, headers, res, controller.signal, 5, 0);

  } catch (err) {
    if (err.message !== 'aborted' && err.message !== 'client disconnected') {
      console.error('[Image Proxy Error]', err.message);
    }
    if (!res.headersSent) res.status(404).end();
  }
};