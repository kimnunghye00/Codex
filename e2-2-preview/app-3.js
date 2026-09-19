function verifyView(){
  const p = receiptState.parsed || {};
  const statusClass = receiptState.status==='done'?'success':receiptState.status==='error'?'error':receiptState.status==='reading'?'working':'';
  return `
    <section class="section">
      <div class="section-head"><div><div class="kicker">Taste data · 01</div><h2 style="margin-top:5px">먹어본 곳을 알려주세요</h2><p class="sub">영수증 한 장이면 방문 정보 대부분을 자동으로 채워드려요.</p></div></div>
      <div class="notice privacy-notice"><strong>사진은 기기에 남겨둬요.</strong> 현재 MVP에서는 영수증 이미지를 서버에 저장하지 않고 브라우저 안에서 글자만 읽습니다.</div>
      <div class="grid" style="margin-top:15px">
        <div class="card upload-card span-5">
          <div class="upload-box ${receiptState.previewUrl?'has-image':''}">
            ${receiptState.previewUrl ? `<img class="receipt-preview" src="${receiptState.previewUrl}" alt="선택한 영수증 미리보기">` : `<div class="receipt-placeholder"><div class="receipt-icon"><svg viewBox="0 0 24 24"><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3"/></svg></div><strong>영수증을 올려주세요</strong><span>가게명 · 날짜 · 금액을 자동으로 읽어요</span></div>`}
            <label class="file-btn" for="receiptFile">${receiptState.previewUrl?'다른 사진 선택':'사진 선택하기'}</label>
            <input id="receiptFile" type="file" accept="image/*" capture="environment" hidden>
          </div>
          <div class="ocr-status ${statusClass}">
            <div class="ocr-status-row"><strong>${receiptState.status==='reading'?'AI가 영수증 읽는 중':receiptState.status==='done'?'인식 완료':receiptState.status==='error'?'인식 실패':'자동 인식 대기'}</strong><span>${receiptState.status==='reading'?Math.round(receiptState.progress*100)+'%':''}</span></div>
            ${receiptState.status==='reading'?`<div class="progress ocr-progress" style="margin-top:9px"><span style="width:${Math.round(receiptState.progress*100)}%"></span></div>`:''}
            <p>${escapeHtml(receiptState.message)}</p>
          </div>
          ${receiptState.rawText ? `<details class="raw-ocr"><summary>인식한 원문 보기</summary><pre>${escapeHtml(receiptState.rawText)}</pre></details>` : ''}
        </div>
        <div class="card span-7">
          <form id="visitForm">
            <div class="form-block-title"><span>1</span> 방문 정보 확인</div>
            <div class="form-grid">
              <div class="field"><label>음식점 이름</label><input required name="name" value="${escapeHtml(p.name||'')}" placeholder="예: 우래옥"></div>
              <div class="field"><label>지역</label><input required name="area" value="${escapeHtml(p.area||'')}" placeholder="예: 서울, 강릉"></div>
              <div class="field"><label>방문 날짜</label><input name="date" type="date" value="${escapeHtml(p.date||new Date().toISOString().slice(0,10))}"></div>
              <div class="field"><label>사업자번호 <span class="optional">선택</span></label><input name="businessNo" value="${escapeHtml(p.businessNo||'')}" placeholder="000-00-00000"></div>
              <div class="field"><label>총 결제 금액</label><input required id="totalAmount" name="totalAmount" type="number" min="0" step="100" value="${Number(p.totalAmount||20000)}"></div>
              <div class="field"><label>함께 먹은 인원</label><input required id="partySize" name="partySize" type="number" min="1" max="30" step="1" value="1"></div>
              <div class="field"><label>1인 기준 금액 <span class="optional">자동</span></label><input id="perPersonPrice" name="price" type="number" min="0" step="100" value="${Number(p.totalAmount||20000)}" readonly></div>
              <div class="field"><label>음식 종류</label><select name="category"><option>고기</option><option>한식</option><option>면</option><option>해산물</option><option>양식</option><option>일식</option><option>중식</option><option>카페</option><option>기타</option></select></div>
            </div>
            <div class="form-block-title" style="margin-top:22px"><span>2</span> 취향 신호 남기기</div>
            <div class="form-grid">
              <div class="field"><label>맵기</label><select name="spicy"><option value="1">거의 안 매움</option><option value="2">약간 매움</option><option value="3">보통</option><option value="4">매움</option><option value="5">매우 매움</option></select></div>
              <div class="field"><label>웨이팅 체감</label><select name="waiting"><option value="1">거의 없음</option><option value="2">짧음</option><option value="3">보통</option><option value="4">김</option><option value="5">매우 김</option></select></div>
              <div class="field"><label>분위기</label><select name="mood"><option>캐주얼</option><option>데이트</option><option>로컬</option><option>여행</option><option>조용함</option></select></div>
            </div>
            <div style="margin-top:18px"><label style="display:block;font-size:11px;color:var(--muted);font-weight:750;margin-bottom:8px">다시 갈 마음은?</label>
              <div class="rating-row"><button type="button" class="rating-btn ${selectedRating===3?'selected':''}" onclick="chooseRating(3)">❤️ 또 갈래요</button><button type="button" class="rating-btn ${selectedRating===2?'selected':''}" onclick="chooseRating(2)">🙂 괜찮아요</button><button type="button" class="rating-btn ${selectedRating===1?'selected':''}" onclick="chooseRating(1)">👎 별로예요</button></div>
            </div>
            <div class="ocr-hint">인식 결과가 틀려도 괜찮아요. 저장하기 전에 가게명과 결제 금액만 한 번 확인해주세요.</div>
            <button class="primary-btn" style="width:100%;margin-top:15px;height:49px" type="submit">이 방문으로 내 취향 학습하기</button>
          </form>
        </div>
      </div>
    </section>`;
}