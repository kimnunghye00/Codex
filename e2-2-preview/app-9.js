function visitsView(){
  const visits=getVisits();
  return `<section class="section"><div class="section-head"><div><div class="kicker">My food log</div><h2 style="margin-top:5px">내가 먹어본 곳</h2><p class="sub">리뷰가 아니라, 추천 알고리즘이 실제로 배우는 나의 식사 기록이에요.</p></div><span class="pill">총 ${visits.length}곳</span></div><div class="card">${visits.length?`<div>${visits.slice().reverse().map(visitRow).join('')}</div>`:`<div class="empty"><div class="empty-illustration"><svg viewBox="0 0 24 24"><path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10z"/></svg></div>아직 등록된 음식점이 없어요.<br>인증 탭에서 첨 영수증을 추가해보세요.</div>`}</div></section>`;
}

function visitRow(v){
  const label=v.rating===3?'또 갈래요':v.rating===2?'괜찮아요':'별로예요';
  const emoji=v.category==='고기'?'🥩':v.category==='한식'?'🍚':v.category==='면'?'🍜':v.category==='해산물'?'🐟':v.category==='양식'?'🍝':v.category==='카페'?'☕':'🍽️';
  const verified=v.source==='receipt'?'<span class="verified-badge">영수증 인증</span>':'';
  return `<div class="visit-card"><div class="visit-main"><div class="visit-avatar">${emoji}</div><div style="min-width:0"><div class="visit-title">${escapeHtml(v.name)} ${verified}</div><div class="visit-sub">${escapeHtml(v.area)} · ${escapeHtml(v.category)} · 1인 ${Number(v.price).toLocaleString()}원 · ${escapeHtml(v.date||'')}</div></div></div><div class="visit-score"><span class="pill ${v.rating===3?'good':v.rating===1?'':'accent'}">${v.rating===3?'♥ ':v.rating===1?'− ':'· '}${label}</span></div></div>`;
}

function tasteView(){
  const p=buildTasteProfile();
  const catMax=Math.max(1,...Object.values(p.catScores));
  const confidence=Math.min(96,18+p.count*13);
  return `<section class="section"><div class="section-head"><div><div class="kicker">Taste DNA</div><h2 style="margin-top:5px">나의 입맛 프로필</h2><p class="sub">먹어본 곳과 평가가 쌓이면서 계속 바뀌는 개인화 프로필이에요.</p></div>${p.count?`<span class="pill accent">신뢰도 ${confidence}%</span>`:''}</div>${p.count?`<div class="taste-panel"><div class="card"><div class="form-block-title"><span>1</span> 음식 카테고리 선호</div><div class="taste-bars">${Object.entries(p.catScores).map(([c,s],i)=>{const pct=Math.round(s/catMax*100);return `<div><div class="taste-bar-head"><strong>${String(i+1).padStart(2,'0')} · ${escapeHtml(c)}</strong><span>${pct}%</span></div><div class="progress"><span style="width:${pct}%"></span></div></div>`}).join('')}</div></div><div class="card taste-profile-card"><div class="kicker">YOUR CURRENT TASTE</div><div class="taste-profile-title">${escapeHtml(p.favoriteCats[0]||'취향 분석 중')}</div><p class="meta" style="margin:0 0 15px;position:relative;z-index:1">${p.count}개의 방문 기록에서 발견한 현재의 취향이에요.</p><div class="taste-profile-chips"><span class="pill accent">${escapeHtml(p.favoriteCats[0]||'미정')} 선호</span><span class="pill">${escapeHtml(p.favoriteMood)}</span><span class="pill">평균 ${p.avgPrice.toLocaleString()}원</span><span class="pill">맵기 ${p.spicy.toFixed(1)}/5</span><span class="pill">웨이팅 ${p.waiting.toFixed(1)}/5</span></div><p class="meta" style="margin-top:22px;position:relative;z-index:1">앞으로 재방문과 영수증 인증이 늘어나면 말로 남긴 리뷰보다 실제 행동을 더 강한 신호로 반영할 예정이에요.</p></div></div>`:`<div class="card empty"><div class="empty-illustration"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg></div><strong style="display:block;color:var(--ink);font-size:15px;margin-bottom:5px">아직 만들어진 입맛 프로필이 없어요.</strong>영수증을 2~3장만 등록해도 음식 종류와 가격대 취향이 보이기 시작해요.</div>`}</section>`;
}

function bindVerifyEvents(){
  const receiptFile=document.getElementById('receiptFile');
  if(receiptFile) receiptFile.addEventListener('change',handleReceiptChange);
  ['totalAmount','partySize'].forEach(id=>document.getElementById(id)?.addEventListener('input',updatePerPersonPrice));
  updatePerPersonPrice();
}

function render(){
  const app=document.getElementById('app');
  app.innerHTML = activeTab==='home'?homeView():activeTab==='verify'?verifyView():activeTab==='explore'?exploreView():activeTab==='visits'?visitsView():tasteView();
  if(activeTab==='verify') bindVerifyEvents();
  if(activeTab==='explore') setTimeout(initExploreMap,0); else destroyExploreMap();
  const form=document.getElementById('visitForm');
  if(form){
    form.addEventListener('submit',e=>{
      e.preventDefault();
      const fd=new FormData(form);
      const visits=getVisits();
      const totalAmount=Number(fd.get('totalAmount')||0);
      const partySize=Math.max(1,Number(fd.get('partySize')||1));
      visits.push({
        id:Date.now(), name:String(fd.get('name')||'').trim(), area:String(fd.get('area')||'').trim(), businessNo:String(fd.get('businessNo')||'').trim(),
        category:fd.get('category'), totalAmount, partySize, price:Math.round(totalAmount/partySize/100)*100,
        spicy:Number(fd.get('spicy')), waiting:Number(fd.get('waiting')), mood:fd.get('mood'), date:fd.get('date'), rating:selectedRating,
        source:receiptState.file?'receipt':'manual', ocrUsed:Boolean(receiptState.rawText)
      });
      saveVisits(visits);
      selectedRating=3;
      if(receiptState.previewUrl) URL.revokeObjectURL(receiptState.previewUrl);
      receiptState={file:null,previewUrl:'',status:'idle',progress:0,message:'영수증을 선택하면 자동으로 읽어볼게요.',rawText:'',parsed:null};
      activeTab='taste';
      document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab==='taste'));
      render();
    });
  }
}

render();
