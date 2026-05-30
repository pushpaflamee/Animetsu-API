// src/utils/cipher.js
const XOR_KEY     = process.env.XOR_KEY     || "s3cr3t_k3y_pr0xy";
const IMG_XOR_KEY = process.env.IMG_XOR_KEY || "1m4g3_p1c_k3y99"; // <-- Secondary Key

// Helper function now accepts a specific key
function xorTransform(input, keyString) {
  const data = Buffer.from(input, "utf-8");
  const key = Buffer.from(keyString, "utf-8");
  for (let i = 0; i < data.length; i++) {
    data[i] ^= key[i % key.length];
  }
  return data;
}

// ── Standard Encoder (Streams / Oppai) ──
function encode(text) {
  if (!text) return '';
  const xored = xorTransform(text, XOR_KEY);
  return xored
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decode(encodedText) {
  if (!encodedText) return '';
  try {
    let b64 = encodedText.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    
    const data = Buffer.from(b64, "base64");
    const key = Buffer.from(XOR_KEY, "utf-8");
    for (let i = 0; i < data.length; i++) {
      data[i] ^= key[i % key.length];
    }
    return data.toString("utf-8");
  } catch (err) {
    console.error('[Cipher Decode Error]', err.message);
    return '';
  }
}

// ── Image Specific Encoder (Episode Images) ──
function encodeImage(text) {
  if (!text) return '';
  const xored = xorTransform(text, IMG_XOR_KEY);
  return xored
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeImage(encodedText) {
  if (!encodedText) return '';
  try {
    let b64 = encodedText.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    
    const data = Buffer.from(b64, "base64");
    const key = Buffer.from(IMG_XOR_KEY, "utf-8");
    for (let i = 0; i < data.length; i++) {
      data[i] ^= key[i % key.length];
    }
    return data.toString("utf-8");
  } catch (err) {
    console.error('[Image Cipher Decode Error]', err.message);
    return '';
  }
}

module.exports = { encode, decode, encodeImage, decodeImage };