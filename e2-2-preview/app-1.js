const STORAGE_KEY = 'e2-2-visits-v2';

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const SEARCH_CACHE_KEY = 'e2-2-place-search-cache-v1';
const POI_CACHE_KEY = 'e2-2-poi-cache-v1';
const SEARCH_RADIUS_DEFAULT = 3000;

let activeTab = 'home';
let selectedRating = 3;
let lastSearch = '';
let searchRadius = SEARCH_RADIUS_DEFAULT;
let liveSearchState = {status:'idle', place:null, placeOptions:[], restaurants:[], message:'', searchedAt:null};
let exploreMap = null;
let receiptState = { file:null, previewUrl:'', status:'idle', progress:0, message:'영수증을 선택하면 자동으로 읽어볼게요.', rawText:'', parsed:null };

function getVisits(){ return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
function saveVisits(v){ localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); }
function ratingWeight(r){ return r===3?1:r===2?0.35:-0.8; }
function escapeHtml(v=''){ return String(v).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function buildTasteProfile(){
  const visits = getVisits();
  const cats = {}, moods = {}, prices = [];
  let spicyWeighted = 0, waitingWeighted = 0, weightSum = 0;
  visits.forEach(v=>{
    const w = Math.max(.2, ratingWeight(v.rating) + 1);
    cats[v.category] = (cats[v.category]||0) + w;
    moods[v.mood] = (moods[v.mood]||0) + w;
    prices.push(Number(v.price||0));
    spicyWeighted += Number(v.spicy||1)*w;
    waitingWeighted += Number(v.waiting||2)*w;
    weightSum += w;
  });
  const sortedCats = Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  const avgPrice = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 20000;
  const favoriteMood = Object.entries(moods).sort((a,b)=>b[1]-a[1])[0]?.[0] || '캐주얼';
  return { count: visits.length, favoriteCats: sortedCats.map(x=>x[0]), catScores: Object.fromEntries(sortedCats), avgPrice, spicy: weightSum ? spicyWeighted/weightSum : 2, waiting: weightSum ? waitingWeighted/weightSum : 2.5, favoriteMood };
}

function scoreRestaurant(r, profile){
  if(profile.count===0) return {score: Math.round(55 + r.rating*7), reasons:['아직 취향 데이터가 적어 인기와 접근성을 중심으로 추천했어요.']};
  let score = 30;
  const reasons=[];
  const top = profile.favoriteCats[0];
  const second = profile.favoriteCats[1];
  if(r.category===top){ score += 28; reasons.push(`가장 자주 좋아한 ${top} 계열이에요.`); }
  else if(r.category===second){ score += 18; reasons.push(`선호도가 높은 ${second} 계열이에요.`); }
  else score += 5;
  const priceGap = Math.abs(r.price-profile.avgPrice);
  score += Math.max(0,15 - priceGap/1500);
  if(priceGap<5000) reasons.push('평소 선택한 가격대와 비슷해요.');
  const spicyGap = Math.abs(r.spicy-profile.spicy);
  score += Math.max(0,8-spicyGap*3);
  if(spicyGap<.8) reasons.push('평소 선호하는 맵기와 가까워요.');
  const waitingGap = Math.max(0,r.waiting-profile.waiting);
  score += Math.max(0,7-waitingGap*2.5);
  if(r.waiting <= profile.waiting+0.5) reasons.push('평소 감수하는 웨이팅 수준과 잘 맞아요.');
  if(r.mood===profile.favoriteMood){ score += 5; reasons.push(`${r.mood} 분위기를 자주 선택했어요.`); }
  score += Math.min(8,r.rating*1.5);
  score += Math.max(0,7-r.distance*2);
  return {score:Math.max(0,Math.min(99,Math.round(score))), reasons:[...new Set(reasons)].slice(0,3)};
}

function setTab(tab){
  activeTab=tab;
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  render();
}

document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
document.getElementById('resetBtn').addEventListener('click',()=>{ if(confirm('저장된 테스트 데이터를 모두 지울까요?')){ localStorage.removeItem(STORAGE_KEY); render(); }});