async function searchPlaces(query){
  const cacheId=query.trim().toLowerCase();
  const cached=cacheGet(SEARCH_CACHE_KEY,cacheId,7*24*60*60*1000);
  if(cached) return cached;
  const u=new URL(NOMINATIM_ENDPOINT);
  u.searchParams.set('q',query);
  u.searchParams.set('format','jsonv2');
  u.searchParams.set('addressdetails','1');
  u.searchParams.set('limit','5');
  u.searchParams.set('countrycodes','kr');
  u.searchParams.set('accept-language','ko');
  const res=await fetch(u.toString(),{headers:{'Accept':'application/json'}});
  if(!res.ok) throw new Error(`장소 검색 오른 (${res.status})`);
  const rows=await res.json();
  cacheSet(SEARCH_CACHE_KEY,cacheId,rows);
  return rows;
}
async function fetchNearbyFood(place,radius=searchRadius){
  const lat=Number(place.lat), lon=Number(place.lon);
  const cacheId=`${place.osm_type}:${place.osm_id}:${radius}`;
  const cached=cacheGet(POI_CACHE_KEY,cacheId,24*60*60*1000);
  if(cached) return cached;
  const q=`[out:json][timeout:25];(nwr[\"amenity\"~\"^(restaurant|fast_food|cafe|food_court)$\"](around:${radius},${lat},${lon}););out center tags;`;
  const res=await fetch(OVERPASS_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'data='+encodeURIComponent(q)});
  if(!res.ok) throw new Error(`주변 음식점 조회 오류 (${res.status})`);
  const data=await res.json();
  const seen=new Set();
  const rows=(data.elements||[]).map(el=>{
    const tags=el.tags||{};
    const plat=Number(el.lat ?? el.center?.lat), plon=Number(el.lon ?? el.center?.lon);
    if(!tags.name || !Number.isFinite(plat) || !Number.isFinite(plon)) return null;
    const dedupe=`${String(tags.name).trim().toLowerCase()}|${plat.toFixed(4)}|${plon.toFixed(4)}`;
    if(seen.has(dedupe)) return null; seen.add(dedupe);
    const category=inferCategory(tags);
    return {
      id:`${el.type}-${el.id}`,osmType:el.type,osmId:el.id,name:tags.name,lat:plat,lon:plon,
      category,emoji:categoryEmoji(category),cuisine:normalizeCuisine(tags.cuisine||''),
      amenity:tags.amenity||'',address:formatOsmAddress(tags),openingHours:tags.opening_hours||'',
      phone:tags.phone||tags['contact:phone']||'',website:tags.website||tags['contact:website']||'',
      distance:haversineKm(lat,lon,plat,plon)
    };
  }).filter(Boolean).sort((a,b)=>a.distance-b.distance).slice(0,80);
  cacheSet(POI_CACHE_KEY,cacheId,rows);
  return rows;
}
