function readCache(key){
  try{return JSON.parse(localStorage.getItem(key)||'{}');}catch(_){return {};}
}
function writeCache(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));}catch(_){}
}
function cacheGet(key,id,maxAgeMs){
  const hit=readCache(key)[id];
  if(!hit || Date.now()-hit.savedAt>maxAgeMs) return null;
  return hit.value;
}
function cacheSet(key,id,value){
  const all=readCache(key); all[id]={savedAt:Date.now(),value}; writeCache(key,all);
}
function haversineKm(lat1,lon1,lat2,lon2){
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function normalizeCuisine(raw=''){
  return String(raw).replaceAll('_',' ').replaceAll(';',', ');
}
function inferCategory(tags={}){
  const c=String(tags.cuisine||'').toLowerCase();
  const n=String(tags.name||'').toLowerCase();
  const a=String(tags.amenity||'').toLowerCase();
  const s=`${c} ${n}`;
  if(a==='cafe' || /coffee|cafe|tea|dessert|bakery/.test(s)) return '카페';
  if(/korean|국밥|찌개|백반|한식|순두부|김밥|분식/.test(s)) return '한식';
  if(/bbq|barbecue|steak|pork|beef|chicken|갈비|고기|삼겹|곱창/.test(s)) return '고기';
  if(/noodle|ramen|udon|soba|국수|냉면|막국수|칼국수|라면/.test(s)) return '면';
  if(/seafood|fish|crab|shellfish|회|물회|조개|해산물/.test(s)) return '해산물';
  if(/japanese|sushi|sashimi|돈카츠|돈까스|일식/.test(s)) return '일식';
  if(/chinese|중식|짜장|짬뽕|마라|딤섬/.test(s)) return '중식';
  if(/italian|pizza|pasta|western|burger|프렌치|파스타|피자/.test(s)) return '양식';
  return '기타';
}
function categoryEmoji(c){
  return ({고기:'🥩',한식:'🍚',면:'🍜',해산물:'🐟',양식:'🍝',일식:'🍣',중식:'🥟',카페:'☕',기타:'🍽️'})[c]||'🍽️';
}
function formatOsmAddress(tags={}){
  const parts=[tags['addr:province'],tags['addr:city'],tags['addr:district'],tags['addr:suburb'],tags['addr:street'],tags['addr:housenumber']].filter(Boolean);
  return [...new Set(parts)].join(' ') || '';
}
function scoreLiveRestaurant(r, profile){
  let score=38;
  const reasons=[];
  if(profile.count===0){
    score += Math.max(0,25-r.distance*5);
    if(r.category!=='기타') score+=8;
    reasons.push('아직 취향 데이터가 적어 가까운 거리와 음식 종류를 중심으로 보여줘요.');
  }else{
    const top=profile.favoriteCats[0], second=profile.favoriteCats[1];
    if(r.category===top){score+=32;reasons.push(`가장 자주 좋아한 ${top} 계열이에요.`);}
    else if(r.category===second){score+=20;reasons.push(`선호도가 높은 ${second} 계열이에요.`);}
    else if(r.category!=='기타'){score+=8;}
    score += Math.max(0,20-r.distance*4);
    if(r.distance<=1) reasons.push('검색한 장소에서 1km 안쪽이에요.');
    else if(r.distance<=3) reasons.push('검색한 장소에서 이동 부담이 적은 편이에요.');
    if(r.category==='기타') reasons.push('음식 종류 데이터가 부족해 거리 비중을 높여 계산했어요.');
  }
  if(r.openingHours) reasons.push('OpenStreetMap에 영업시간 정보가 등록된 곳이에요.');
  return {score:Math.max(30,Math.min(96,Math.round(score))),reasons:[...new Set(reasons)].slice(0,3)};
}
