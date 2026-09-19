function homeView(){
  const p=buildTasteProfile();
  const visits=getVisits();
  const confidence=Math.min(96,18+p.count*13);
  const favorite=p.favoriteCats[0]||'아직 학습 중';
  return `
    <section class="screen-head">
      <div><div class="kicker">FOR YOU</div><h1>오늘은 어디서 먹을까요?</h1><p>목적지만 정하면 내 취향에 맞는 주변 맛집을 바로 찾아드려요.</p></div>
      <span class="pill accent">${p.count ? '취향 '+confidence+'%' : '첫 기록 필요'}</span>
    </section>

    <section class="quick-grid">
      <button class="quick-card accent" onclick="setTab('explore')"><span class="icon">⌕</span><div><strong>근처 맛집 찾기</strong><small>지역·관광지·역 주변을 내 취향 순으로 추천</small></div></button>
      <button class="quick-card" onclick="setTab('verify')"><span class="icon">＋</span><div><strong>먹은 곳 기록</strong><small>영수증으로 방문을 인증하고 취향을 학습</small></div></button>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>내 취향 요약</h2><p class="sub">기록이 쌓일수록 추천이 더 정확해져요.</p></div><button class="quick-area" onclick="setTab('taste')">자세히</button></div>
      <div class="grid">
        <div class="card stat-card span-4"><div class="stat-icon">♥</div><div class="stat-row"><div><div class="stat">${escapeHtml(favorite)}</div><div class="stat-label">가장 강한 취향</div></div><span class="stat-delta">TOP</span></div></div>
        <div class="card stat-card span-4"><div class="stat-icon">₩</div><div class="stat-row"><div><div class="stat">${p.count?p.avgPrice.toLocaleString()+'원':'—'}</div><div class="stat-label">평균 1인 가격대</div></div><span class="stat-delta">AVG</span></div></div>
        <div class="card stat-card span-4"><div class="stat-icon">✓</div><div class="stat-row"><div><div class="stat">${p.count}</div><div class="stat-label">학습된 방문 기록</div></div><span class="stat-delta">DATA</span></div></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>최근 먹어본 곳</h2><p class="sub">최근 기록이 추천에 바로 반영돼요.</p></div><button class="quick-area" onclick="setTab('visits')">전체 보기</button></div>
      <div class="card">${visits.length ? `<div>${visits.slice(-3).reverse().map(visitRow).join('')}</div>` : `<div class="empty"><div class="empty-illustration">🍽️</div><strong style="display:block;color:var(--ink);margin-bottom:5px">아직 방문 기록이 없어요.</strong>먹어본 곳을 기록하면 바로 취향 학습을 시작해요.</div>`}</div>
    </section>`;
}