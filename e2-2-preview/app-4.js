function chooseRating(r){ selectedRating=r; render(); }

function normalizeDate(text){
  const m = text.match(/(20\d{2}|19\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/);
  if(!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
}

function parseAmount(v){
  const n = Number(String(v||'').replace(/[^\d]/g,''));
  return Number.isFinite(n) ? n : 0;
}

function detectArea(text){
  const areas=['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주','강릉','속초','춘천','원주','전주','여수','순천','경주','포항','창원','김해','수원','성남','용인','고양','양주','철원'];
  return areas.find(a=>text.includes(a)) || '';
}

function parseReceiptText(text){
  const cleaned = text.replace(/\r/g,'');
  const lines = cleaned.split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const businessNo = cleaned.match(/\b(\d{3})\s*[-.]?\s*(\d{2})\s*[-.]?\s*(\d{5})\b/);
  const date = normalizeDate(cleaned);
  const area = detectArea(cleaned);
  const amountKeywords = /(결제\s*금액|받을\s*금액|합\s*계|총\s*액|총액|승인\s*금액|판매\s*합계|카드\s*결제)/i;
  let totalAmount = 0;
  const keywordAmounts=[];
  lines.forEach(line=>{
    if(amountKeywords.test(line)){
      const nums = [...line.matchAll(/(?:₩|￦)?\s*([\d,]{3,})\s*원?/g)].map(m=>parseAmount(m[1])).filter(n=>n>=1000 && n<10000000);
      keywordAmounts.push(...nums);
    }
  });
  if(keywordAmounts.length) totalAmount=Math.max(...keywordAmounts);
  if(!totalAmount){
    const allAmounts=[...cleaned.matchAll(/(?:₩|￦)?\s*([\d]{1,3}(?:,\d{3})+|\d{4,7})\s*원?/g)].map(m=>parseAmount(m[1])).filter(n=>n>=1000 && n<10000000);
    if(allAmounts.length) totalAmount=Math.max(...allAmounts);
  }

  const skip = /(영수증|receipt|사업자|대표|주소|전화|tel|승인|카드|금액|합계|부가세|과세|면세|현금|일시불|고객|가맹점|거래|판매|단말|주문|테이블|번호|수량|단가|공급가)/i;
  const nameCandidates = lines.slice(0,10).filter(line=>{
    if(skip.test(line) || /\d{2,}/.test(line)) return false;
    const letters=(line.match(/[가-힣A-Za-z]/g)||[]).length;
    return letters>=2 && line.length<=35;
  });
  const name = nameCandidates[0] || '';
  return { name, area, businessNo: businessNo ? `${businessNo[1]}-${businessNo[2]}-${businessNo[3]}` : '', date, totalAmount };
}

async function preprocessReceipt(file){
  const bitmap = await createImageBitmap(file);
  const maxWidth=1800;
  const scale=Math.min(1,maxWidth/bitmap.width);
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));
  canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const img=ctx.getImageData(0,0,canvas.width,canvas.height);
  const d=img.data;
  for(let i=0;i<d.length;i+=4){
    const gray=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    const contrast=Math.max(0,Math.min(255,(gray-128)*1.35+128));
    d[i]=d[i+1]=d[i+2]=contrast;
  }
  ctx.putImageData(img,0,0);
  bitmap.close?.();
  return canvas;
}

async function scanReceipt(file){
  if(!window.Tesseract){
    receiptState={...receiptState,status:'error',message:'OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하고 직접 입력해주세요.'};
    render(); return;
  }
  receiptState={...receiptState,status:'reading',progress:0,message:'OCR 엔진을 준비하고 있어요…',rawText:'',parsed:null};
  render();
  let worker;
  try{
    const canvas=await preprocessReceipt(file);
    worker = await Tesseract.createWorker('kor+eng', 1, {
      logger:m=>{
        const p=Number(m.progress||0);
        const label = m.status==='recognizing text' ? '영수증 글자를 읽고 있어요…' : 'OCR 엔진을 준비하고 있어요…';
        receiptState={...receiptState,status:'reading',progress:p,message:label};
        updateOcrStatusOnly();
      }
    });
    const ret=await worker.recognize(canvas);
    const rawText=(ret.data.text||'').trim();
    const parsed=parseReceiptText(rawText);
    receiptState={...receiptState,status:'done',progress:1,message:'자동 인식이 끝났어요. 오른쪽 결과를 확인하고 틀린 부분만 수정해주세요.',rawText,parsed};
    render();
  }catch(err){
    console.error(err);
    receiptState={...receiptState,status:'error',progress:0,message:'자동 인식에 실패했습니다. 사진을 다시 찍거나 오른쪽 입력란에 직접 입력해주세요.'};
    render();
  }finally{
    if(worker){ try{ await worker.terminate(); }catch(_){} }
  }
}

function updateOcrStatusOnly(){
  const box=document.querySelector('.ocr-status');
  if(!box) return;
  const percent=Math.round(receiptState.progress*100);
  box.className='ocr-status working';
  box.innerHTML=`<div class="ocr-status-row"><strong>영수증 읽는 중</strong><span>${percent}%</span></div><div class="progress ocr-progress"><span style="width:${percent}%"></span></div><p>${escapeHtml(receiptState.message)}</p>`;
}

function handleReceiptChange(e){
  const file=e.target.files?.[0];
  if(!file) return;
  if(receiptState.previewUrl) URL.revokeObjectURL(receiptState.previewUrl);
  receiptState={file,previewUrl:URL.createObjectURL(file),status:'idle',progress:0,message:'사진을 선택했어요. 잠시 후 자동으로 읽습니다.',rawText:'',parsed:null};
  render();
  scanReceipt(file);
}

function updatePerPersonPrice(){
  const total=Number(document.getElementById('totalAmount')?.value||0);
  const party=Math.max(1,Number(document.getElementById('partySize')?.value||1));
  const field=document.getElementById('perPersonPrice');
  if(field) field.value=Math.round(total/party/100)*100;
}
