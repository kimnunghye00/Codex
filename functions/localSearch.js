/**
 * NAVER's local-search API uses different credentials from NAVER Maps JS.
 * This endpoint is intentionally NOT enabled by the web build until its
 * NAVER_LOCAL_SEARCH_ID and NAVER_LOCAL_SEARCH_SECRET secrets are provisioned.
 */
const { getAuth } = require('firebase-admin/auth');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');

const naverId = defineSecret('NAVER_LOCAL_SEARCH_ID');
const naverSecret = defineSecret('NAVER_LOCAL_SEARCH_SECRET');
const ALLOWED_ORIGINS = new Set([
  'https://danduli.web.app', 'https://danduli.firebaseapp.com',
  'https://meluni-f4e00.web.app', 'https://meluni-f4e00.firebaseapp.com',
]);

function sendJson(res, status, body) {
  res.status(status).set('Cache-Control', 'private, no-store')
    .set('X-Content-Type-Options', 'nosniff').json(body);
}

function cleanName(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

function normalizePlace(item) {
  const longitude = Number(item.mapx) / 1e7;
  const latitude = Number(item.mapy) / 1e7;
  // Old NAVER Search responses could use projected coordinates. Never
  // mistake them for WGS84 and silently put a marker in another province.
  if (!Number.isFinite(longitude) || longitude < 124 || longitude > 132
    || !Number.isFinite(latitude) || latitude < 33 || latitude > 39) return null;
  const placeName = cleanName(item.title);
  const address = cleanName(item.roadAddress || item.address);
  if (!placeName || !address) return null;
  return { latitude, longitude, placeName, address, source: 'naver-local' };
}

exports.searchDatePlaces = onRequest({
  region: 'asia-northeast3', timeoutSeconds: 12, memory: '256MiB',
  secrets: [naverId, naverSecret],
}, async (req, res) => {
  const origin = req.get('origin') || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) return sendJson(res, 403, { error: 'origin-not-allowed' });
  if (origin) res.set('Access-Control-Allow-Origin', origin).set('Vary', 'Origin');
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' });
  const token = (req.get('authorization') || '').match(/^Bearer (\S+)$/)?.[1];
  if (!token || token.length > 8192) return sendJson(res, 401, { error: 'authentication-required' });
  try { await getAuth().verifyIdToken(token, true); }
  catch { return sendJson(res, 401, { error: 'invalid-authentication' }); }

  const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
  const region = typeof req.query.region === 'string' ? req.query.region.trim() : '';
  if (!query || query.length > 100 || region.length > 50) return sendJson(res, 400, { error: 'invalid-query' });
  if (!naverId.value() || !naverSecret.value()) return sendJson(res, 503, { error: 'search-not-configured' });
  const queries = [...new Set([region ? region + ' ' + query : query, query])].slice(0, 2);
  const results = [];
  const seen = new Set();
  try {
    for (const text of queries) {
      const url = new URL('https://openapi.naver.com/v1/search/local.json');
      url.search = new URLSearchParams({ query: text, display: '5', start: '1', sort: 'random' }).toString();
      const response = await fetch(url, {
        headers: { 'X-Naver-Client-Id': naverId.value(), 'X-Naver-Client-Secret': naverSecret.value() },
        signal: AbortSignal.timeout(4500), redirect: 'error',
      });
      if (!response.ok) {
        console.error('[DANDULI NAVER local search]', response.status);
        return sendJson(res, 502, { error: 'search-provider-unavailable' });
      }
      const body = await response.json();
      if (!Array.isArray(body.items)) return sendJson(res, 502, { error: 'invalid-search-response' });
      for (const item of body.items) {
        const place = normalizePlace(item);
        if (!place) continue;
        const key = [place.latitude.toFixed(6), place.longitude.toFixed(6)].join(':');
        if (seen.has(key)) continue;
        seen.add(key); results.push(place);
      }
    }
    return sendJson(res, 200, { results, provider: 'naver-local', pageSizeLimit: 5 });
  } catch (cause) {
    console.error('[DANDULI NAVER local search]', cause instanceof Error ? cause.message : 'upstream error');
    return sendJson(res, 502, { error: 'search-provider-unavailable' });
  }
});
