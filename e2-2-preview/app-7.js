async function loadPlaceRestaurants(place){
  liveSearchState={...liveSearchState,status:'loading',place,restaurants:[],message:'주변 음식점을 찾고 있어요…'};
  render();
  try{
    const rows=await fetchNearbyFood(place,searchRadius);
    const p=buildTasteProfile();
    const scored=rows.map(r=>({...r,...scoreLiveRestaurant(r,p)})).sort((a,b)=>b.score-a.score || a.distance-b.distance).slice(0,30);
    liveSearchState={...liveSearchState,status:'done',place,restaurants:scored,message:scored.length?`${scored.length}곳을 실제 지도 데이터에서 찾았어요.`:'이 반경에서는 이름이 등록된 음식점을 찾지 못했어요.',searchedAt:Date.now()};
  }catch(err){
    console.error(err);
    liveSearchState={...liveSearchState,status:'error',place,restaurants:[],message:'주변 음식점 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'};
  }
  render();
}
async function doSearch(override){
  const input=document.getElementById('areaSearch');
  const query=String(override ?? input?.value ?? lastSearch).trim();
  if(!query) return;
  lastSearch=query;
  liveSearchState={status:'locating',place:null,placeOptions:[],restaurants:[],message:'장소의 위치를 찾고 있어요…',searchedAt:null};
  render();
  try{
    const options=await searchPlaces(query);
    if(!options.length){liveSearchState={...liveSearchState,status:'error',message:'한국 내에서 검색 결과를 찾지 못했어요.'};render();return;}
    liveSearchState={...liveSearchState,placeOptions:options};
    await loadPlaceRestaurants(options[0]);
  }catch(err){
    console.error(err);
    liveSearchState={...liveSearchState,status:'error',message:'장소 검색에 실패했어요. 네트워크 연결을 확인해주세요.'};
    render();
  }
}
function choosePlace(index){
  const place=liveSearchState.placeOptions?.[index];
  if(place) loadPlaceRestaurants(place);
}
function setSearchRadius(radius){
  searchRadius=radius;
  if(liveSearchState.place) loadPlaceRestaurants(liveSearchState.place);
  else render();
}
function destroyExploreMap(){
  if(exploreMap){try{exploreMap.remove();}catch(_){} exploreMap=null;}
}
function initExploreMap(){
  destroyExploreMap();
  if(!window.L || !liveSearchState.place || liveSearchState.status!=='done') return;
  const el=document.getElementById('exploreMap'); if(!el) return;
  const place=liveSearchState.place;
  exploreMap=L.map(el,{zoomControl:true,scrollWheelZoom:false}).setView([Number(place.lat),Number(place.lon)],14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(exploreMap);
  const baseIcon=L.divIcon({className:'e2-map-marker-wrap',html:'<div class="e2-map-marker origin"><span>◎</span></div>',iconSize:[34,34],iconAnchor:[17,17]});
  L.marker([Number(place.lat),Number(place.lon)],{icon:baseIcon}).addTo(exploreMap).bindPopup(`<strong>${escapeHtml(place.display_name?.split(',')[0]||lastSearch)}</strong><br>검색 기준 위치`);
  const bounds=[[Number(place.lat),Number(place.lon)]];
  liveSearchState.restaurants.slice(0,20).forEach((r,i)=>{
    const icon=L.divIcon({className:'e2-map-marker-wrap',html:`<div class="e2-map-marker"><span>${i+1}</span></div>`,iconSize:[30,30],iconAnchor:[15,15]});
    L.marker([r.lat,r.lon],{icon}).addTo(exploreMap).bindPopup(`<strong>${escapeHtml(r.name)}</strong><br>${escapeHtml(r.category)} · ${r.distance.toFixed(1)}km<br>취향 매치 ${r.score}%`);
    bounds.push([r.lat,r.lon]);
  });
  if(bounds.length>1) exploreMap.fitBounds(bounds,{padding:[28,28],maxZoom:15});
}
