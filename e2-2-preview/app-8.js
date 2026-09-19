function exploreView(){
  const p=buildTasteProfile();
  const st=liveSearchState;
  const placeName=st.place?.display_name?.split(',')[0] || lastSearch || '목적지';
  const loading=st.status==='locating'||st.status==='loading';
  const options=(st.placeOptions||[]).slice(0,4);
  return `<section class="search-hero">
      <div class="kicker">Taste search · 02</div>
      <h2 style="font-size:29px;margin-top:7px">어디로 놀러 가나요?</h2>
      <p class="sub" style="max-width:640px">지역, 관광지, 역 이름을 검색하면 실제 위치 주변의 음식점을 불러온 뒤 <strong style="color:var(--ink)">내가 좋아할 가능성</strong>으로 다시 정렬해요.</p>
      <div class="searchbar"><input id="areaSearch" value="${escapeHtml(lastSearch)}" placeholder="예: 속초아이, 경포해변, 성수역"><button onclick="doSearch()" ${loading?'disabled':''}>${loading?'찾는 중…':'내 취향으로 찾기'}</button></div>
      <div class="quick-areas">${['속초아이','경포해변','성수역','해운대해수욕장','제주공항'].map(a=>`<button class="quick-area" onclick="doSearch('${a}')">${a}</button>`).join('')}</div>
      <div class="live-data-note"><span class="live-dot"></span> 실제 OpenStreetMap 장소 데이터 · 검색할 때만 요청 · 자동완성 없음</div>
    </section>
    ${st.status==='idle'?`<section class="section"><div class="card empty"><div class="empty-illustration">⌖</div><strong style="display:block;color:var(--ink);font-size:15px;margin-bottom:5px">목적지를 먼저 검색해보세요.</strong>검색한 장소를 중심으로 실제 음식점을 찾아 E2-2의 취향 점수로 정렬합니다.</div></section>`:''}
    ${loading?`<section class="section"><div class="card live-loading"><div class="search-spinner"></div><div><strong>${escapeHtml(st.message)}</strong><p>공개 지도 데이터를 조회하고 있습니다.</p></div></div></section>`:''}
    ${st.status==='error'?`<section class="section"><div class="card empty"><div class="empty-illustration">!</div><strong style="display:block;color:var(--ink);font-size:15px;margin-bottom:5px">검색을 완료하지 못했어요.</strong>${escapeHtml(st.message)}</div></section>`:''}
    ${st.place?`<section class="section">
      <div class="section-head"><div><div class="kicker">SEARCH BASE</div><h2 style="margin-top:5px">${escapeHtml(placeName)} 주변</h2><p class="sub">${escapeHtml(st.place.display_name||'')}</p></div><span class="pill accent">반경 ${(searchRadius/1000).toFixed(0)}km</span></div>
      ${options.length>1?`<div class="place-options"><span>다른 검색 결과</span>${options.map((o,i)=>`<button class="quick-area ${o.osm_id===st.place.osm_id?'selected':''}" onclick="choosePlace(${i})">${escapeHtml(o.display_name.split(',').slice(0,2).join(' '))}</button>`).join('')}</div>`:''}
      <div class="radius-row"><span>검색 반경</span>${[1000,3000,5000].map(r=>`<button class="radius-btn ${searchRadius===r?'active':''}" onclick="setSearchRadius(${r})">${r/1000}km</button>`).join('')}</div>
      ${st.status==='done'?`<div id="exploreMap" class="explore-map" aria-label="주변 음식점 지도"></div>`:''}
    </section>`:''}
    ${st.status==='done'?`<section class="section"><div class="section-head"><div><h2>${escapeHtml(placeName)}에서 너에게 맞는 곳</h2><p class="sub">${p.count?`${p.count}개의 실제 방문 기록과 확인 가능한 장소 속성·거리를 반영했어요.`:'취향 기록이 적어 현재는 음식 종류와 거리를 중심으로 정렬해요.'}</p></div><span class="pill accent">${st.restaurants.length}곳</span></div>${st.restaurants.length?`<div class="list">${st.restaurants.map((r,i)=>restaurantCard(r,i)).join('')}</div>`:`<div class="card empty">${escapeHtml(st.message)}</div>`}</section>`:''}
    <section class="section"><div class="osm-disclaimer">프로토타입 데이터: OpenStreetMap / Nominatim / Overpass. 공개 서버는 소규모 테스트용이며, 정식 서비스에서는 전용 장소 데이터 제공자 또는 자체 프록시·캐시 서버로 교체합니다.</div></section>`;
}
function restaurantCard(r,i){
  const cuisine=r.cuisine?` · ${escapeHtml(r.cuisine)}`:'';
  const hours=r.openingHours?`<span class="data-chip">영업시간 데이터 있음</span>`:'';
  const address=r.address?`<div class="result-address">${escapeHtml(r.address)}</div>`:'';
  return `<div class="card result-card">
    <div class="thumb">${r.emoji}</div>
    <div>
      <div class="result-rank">REAL PLACE · ${String(i+1).padStart(2,'0')}</div>
      <div class="result-title">${escapeHtml(r.name)}</div>
      <div class="result-meta"><span>${escapeHtml(r.category)}${cuisine}</span><span>·</span><span>${r.distance.toFixed(1)}km</span>${hours}</div>
      ${address}
      <div class="reason"><span class="reason-dot"></span><span>${r.reasons.map(escapeHtml).join(' ')}</span></div>
    </div>
    <div class="match"><strong>${r.score}%</strong><span>현재 취향 매치</span></div>
  </div>`;
}
