/**
 * NAVER local search returns at most five entries per query. Try nearby
 * district/locality variants to discover a visible branch before global ones.
 * No results are fabricated; the UI still applies strict viewport filtering.
 */
function buildLocalSearchQueries(query, region) {
  const place = String(query || '').trim();
  const parts = String(region || '').trim().split(/\s+/).filter(Boolean);
  const locality = parts.length >= 3 ? parts.at(-1) : '';
  const district = parts.length >= 2 ? parts.slice(0, 2).at(-1) : '';
  const broad = parts.length >= 2 ? parts.slice(0, 2).join(' ') : '';
  return [...new Set([
    locality ? locality + ' ' + place : '',
    locality ? place + ' ' + locality : '',
    district ? district + ' ' + place : '',
    district ? place + ' ' + district : '',
    broad ? broad + ' ' + place : '',
    region ? region.trim() + ' ' + place : '',
    place,
  ].filter(Boolean))].slice(0, 7);
}

module.exports = { buildLocalSearchQueries };
