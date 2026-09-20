const PROVINCES: Record<string, string> = {
  서울: '서울', 서울시: '서울', 서울특별시: '서울', 부산: '부산', 부산시: '부산', 부산광역시: '부산',
  대구: '대구', 대구광역시: '대구', 인천: '인천', 인천광역시: '인천', 광주: '광주', 광주광역시: '광주',
  대전: '대전', 대전광역시: '대전', 울산: '울산', 울산광역시: '울산', 세종: '세종', 세종시: '세종', 세종특별자치시: '세종',
  경기: '경기', 경기도: '경기', 강원: '강원', 강원도: '강원', 강원특별자치도: '강원',
  충북: '충북', 충청북도: '충북', 충남: '충남', 충청남도: '충남', 전북: '전북', 전라북도: '전북', 전북특별자치도: '전북',
  전남: '전남', 전라남도: '전남', 경북: '경북', 경상북도: '경북', 경남: '경남', 경상남도: '경남',
  제주: '제주', 제주도: '제주', 제주특별자치도: '제주',
};
// Legacy saved addresses may omit the province (for example “삼척시 성내동”).
// Only unambiguous municipality names are inferred; shared district names stay unknown.
const MUNICIPALITIES: Record<string, string> = {
  경기: '수원시 성남시 의정부시 안양시 부천시 광명시 평택시 동두천시 안산시 고양시 과천시 구리시 남양주시 오산시 시흥시 군포시 의왕시 하남시 용인시 파주시 이천시 안성시 김포시 화성시 광주시 양주시 포천시 여주시 연천군 가평군 양평군',
  강원: '춘천시 원주시 강릉시 동해시 태백시 속초시 삼척시 홍천군 횡성군 영월군 평창군 정선군 철원군 화천군 양구군 인제군 양양군',
  충북: '청주시 충주시 제천시 보은군 옥천군 영동군 증평군 진천군 괴산군 음성군 단양군',
  충남: '천안시 공주시 보령시 아산시 서산시 논산시 계룡시 당진시 금산군 부여군 서천군 청양군 홍성군 예산군 태안군',
  전북: '전주시 군산시 익산시 정읍시 남원시 김제시 완주군 진안군 무주군 장수군 임실군 순창군 고창군 부안군',
  전남: '목포시 여수시 순천시 나주시 광양시 담양군 곡성군 구례군 고흥군 보성군 화순군 장흥군 강진군 해남군 영암군 무안군 함평군 영광군 장성군 완도군 진도군 신안군',
  경북: '포항시 경주시 김천시 안동시 구미시 영주시 영천시 상주시 문경시 경산시 의성군 청송군 영양군 영덕군 청도군 고령군 성주군 칠곡군 예천군 봉화군 울진군 울릉군',
  경남: '창원시 진주시 통영시 사천시 김해시 밀양시 거제시 양산시 의령군 함안군 창녕군 남해군 하동군 산청군 함양군 거창군 합천군',
  제주: '제주시 서귀포시',
};
const MUNICIPALITY_PROVINCE = new Map(Object.entries(MUNICIPALITIES).flatMap(([province, names]) => names.split(' ').map((name) => [name, province] as const)));
export const REGION_ORDER = ['서울', '경기', '인천', '강원', '대전', '세종', '충북', '충남', '부산', '대구', '울산', '경북', '경남', '광주', '전북', '전남', '제주', '지역 미분류'];
/** Korean road addresses and reverse-ordered comma-separated OSM addresses. */
export function placeRegion(address: string): { province: string; district: string } {
  const tokens = address.split(/[\s,·]+/).filter(Boolean);
  const provinceToken = tokens.find((token) => PROVINCES[token]);
  const inferred = tokens.map((token) => MUNICIPALITY_PROVINCE.get(token)).find(Boolean);
  const province = provinceToken ? PROVINCES[provinceToken] : inferred || '지역 미분류';
  const districts = tokens.filter((token) => !PROVINCES[token] && /^[가-힣]+[시군구]$/.test(token));
  const city = districts.find((token) => /[시군]$/.test(token));
  const district = districts.find((token) => /구$/.test(token));
  return { province, district: [city, district].filter(Boolean).join(' ') || (province === '세종' ? '세종시' : '시·군·구 미분류') };
}


export function groupSavedPlaces<T extends { address: string; name: string }>(places: readonly T[]) {
  const regions = new Map<string, Map<string, T[]>>();
  for (const place of places) {
    const { province, district } = placeRegion(place.address);
    if (!regions.has(province)) regions.set(province, new Map());
    const districts = regions.get(province)!;
    if (!districts.has(district)) districts.set(district, []);
    districts.get(district)!.push(place);
  }
  return [...regions].sort(([a], [b]) => REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b)).map(([name, districts]) => ({
    name,
    count: [...districts.values()].reduce((sum, items) => sum + items.length, 0),
    districts: [...districts].sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([name, items]) => ({ name, places: [...items].sort((a, b) => a.name.localeCompare(b.name, 'ko')) })),
  }));
}
