/**
 * NAVER API HUB local search uses separate credentials from NAVER Maps JS.
 * This endpoint is intentionally NOT enabled by the web build until its
 * NAVER_LOCAL_SEARCH_ID and NAVER_LOCAL_SEARCH_SECRET secrets are provisioned.
 */
const { getAuth } = require('firebase-admin/auth');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { buildLocalSearchQueries } = require('./localSearchQueries.cjs');

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
  region: 'asia-northeast3', timeoutSeconds: 18, memory: '256MiB',
  // The web client sends Authorization, so its GET request is preflighted.
  // Firebase CORS middleware must answer OPTIONS before token verification.
  cors: [...ALLOWED_ORIGINS],
  secrets: [naverId, naverSecret],
}, async (req, res) => {
  const origin = req.get('origin') || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) return sendJson(res, 403, { error: 'origin-not-allowed' });
  // Origin headers and OPTIONS are handled by the function's CORS middleware.
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' });
  const token = (req.get('authorization') || '').match(/^Bearer (\S+)$/)?.[1];
  if (!token || token.length > 8192) return sendJson(res, 401, { error: 'authentication-required' });
  try { await getAuth().verifyIdToken(token, true); }
  catch { return sendJson(res, 401, { error: 'invalid-authentication' }); }

  const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
  const region = typeof req.query.region === 'string' ? req.query.region.trim() : '';
  if (!query || query.length > 100 || region.length > 50) return sendJson(res, 400, { error: 'invalid-query' });
  if (!naverId.value() || !naverSecret.value()) return sendJson(res, 503, { error: 'search-not-configured' });
  // One broad query has only five results. Search both locality- and district-
  // first variants so a nearby CGV branch is not displaced by nationwide CGVs.
  const queries = buildLocalSearchQueries(query, region);
  // Independent nearby and name searches run concurrently. Preserve local
  // priority when merging. The client will still require actual map bounds.
  const responses = await Promise.allSettled(queries.map(async (text) => {
    const url = new URL('https://naverapihub.apigw.ntruss.com/search/v1/local');
    url.search = new URLSearchParams({ query: text, display: '5', start: '1', sort: 'random', format: 'json' }).toString();
    const response = await fetch(url, {
      headers: { 'X-NCP-APIGW-API-KEY-ID': naverId.value(), 'X-NCP-APIGW-API-KEY': naverSecret.value() },
      signal: AbortSignal.timeout(4500), redirect: 'error',
    });
    if (!response.ok) throw new Error('NAVER provider HTTP ' + response.status);
    const body = await response.json();
    if (!Array.isArray(body.items)) throw new Error('Invalid NAVER search response');
    return body.items;
  }));
  const results = [];
  const seen = new Set();
  let successfulQueries = 0;
  for (const response of responses) {
    if (response.status !== 'fulfilled') {
      console.error('[DANDULI NAVER local search]', response.reason instanceof Error ? response.reason.message : 'upstream error');
      continue;
    }
    successfulQueries += 1;
    for (const item of response.value) {
      const place = normalizePlace(item);
      if (!place) continue;
      const key = [place.latitude.toFixed(6), place.longitude.toFixed(6)].join(':');
      if (seen.has(key)) continue;
      seen.add(key); results.push(place);
    }
  }
  if (!successfulQueries) return sendJson(res, 502, { error: 'search-provider-unavailable' });
  return sendJson(res, 200, { results, provider: 'naver-local', pageSizeLimit: 5, queryVariants: queries.length });
});
