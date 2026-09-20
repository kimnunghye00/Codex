# 단둘이: 네이버 지역 검색 연결

현재 지도는 NAVER Maps JS를 사용하지만 기존 검색은 OpenStreetMap(Nominatim/Overpass) 데이터입니다.
네이버 지도에 표시되는 사업장을 같은 데이터로 검색하려면 **별도의 NAVER CLOUD PLATFORM → NAVER API HUB 지역 검색 API**가 필요합니다.
지도용 `ncpKeyId`는 지역 검색의 `X-NCP-APIGW-API-KEY-ID`/`X-NCP-APIGW-API-KEY`를 대신하지 않습니다.

## 준비 및 연결

1. NAVER CLOUD PLATFORM(https://console.ncloud.com/naver-api-hub/application)에서 **NAVER API HUB → 지역**을 선택해 검색용 애플리케이션을 등록합니다.
   발급받은 검색용 Client ID와 Client Secret은 소스 코드, `.env`, 채팅 또는 프런트엔드에 넣지 마세요.
2. 기존 Firebase 프로젝트 `meluni-f4e00`에 두 비밀값을 등록합니다. 인증된 개발 환경에서 다음 명령을 각각 실행하면 값은 별도 비공개 입력으로 받습니다.
   - `npx firebase-tools@15.29.0 functions:secrets:set NAVER_LOCAL_SEARCH_ID --project meluni-f4e00`
   - `npx firebase-tools@15.29.0 functions:secrets:set NAVER_LOCAL_SEARCH_SECRET --project meluni-f4e00`
3. 비밀값을 등록한 뒤 GitHub → **Actions** → **Deploy 단둘이 Naver Search** → **Run workflow**를 실행합니다.
   이 워크플로는 `searchDatePlaces` 함수만 배포하며 기존 Firestore/Hosting은 변경하지 않습니다.
   직접 실행하려면 `npx firebase-tools@15.29.0 deploy --only functions:searchDatePlaces --project meluni-f4e00`를 사용해도 됩니다.
   Functions 배포에는 Firebase Blaze 요금제 및 배포 권한이 필요할 수 있습니다. 기존 Firestore 데이터는 이전하지 않습니다.
4. Firebase 콘솔에서 배포된 `searchDatePlaces`의 **실제 HTTPS URL**을 확인합니다.
   GitHub 저장소 Settings → Secrets and variables → Actions → **Variables**에
   `VITE_NAVER_LOCAL_SEARCH_URL` 변수로 이 공개 URL만 추가합니다.
   비밀 ID/Secret은 GitHub 변수나 Vite 환경변수로 옮기지 않습니다.
5. GitHub Actions → **Deploy 단둘이 Web** → Run workflow로 최신 `main`을 다시 배포합니다.
   웹에서 이 변수가 비어 있으면 기존 OSM 검색으로 돌아갑니다.

## 검색 방식과 제약

- NAVER 지역 검색은 문서상 한 번의 호출당 최대 5개이며, 지도 화면 좌표로 필터하는 API가 아닙니다.
  현재 지도 검색에서는 지역명을 함께 검색하고, 반환된 WGS84 좌표를 화면 경계로 다시 필터합니다.
- 전국 검색은 상호명 + 지점명을 활용하고, 지역 조건이 명시되면 다른 지역 지점을 제외합니다.
- NAVER 검색 결과가 5개 안에 원하는 가게를 포함하지 않는 경우에는 지도에서 위치를 직접 선택할 수 있습니다.
  표시된 모든 네이버 지도 라벨이 자동으로 검색되는 **완전한 지도-검색 일치 기능은 보장하지 않습니다**.
- 서버는 로그인 사용자의 토큰을 검사하고 지역 검색용 Secret을 비공개로 유지합니다.
  클라이언트로는 결과 장소명/주소/좌표만 돌려줍니다.

## 컴퓨터에 터미널이 없는 경우

NAVER API HUB에서 지역 검색용 ID와 Secret을 발급받은 뒤 Google Cloud Console → **Secret Manager**에서 프로젝트 `meluni-f4e00`을 선택하고 `NAVER_LOCAL_SEARCH_ID` / `NAVER_LOCAL_SEARCH_SECRET` 두 Secret을 각각 등록하세요. GitHub에 비밀값을 입력할 필요가 없습니다. 실제 비밀값이 생성된 것이 확인되면 위 수동 GitHub Actions 워크플로를 실행하면 됩니다. 서버 함수 배포 오류가 나면 GitHub Actions 로그에서 **오류 문구만** 공유하고 Secret 자체는 공유하지 마세요.

클라이언트 쪽 검색은 `VITE_NAVER_LOCAL_SEARCH_URL`이 실제 함수 URL로 설정되고 웹을 재배포하기 전까지 기존 검색 경로를 유지합니다. **이 단계에서 등록만으로 모든 네이버 지도 라벨을 검색할 수 있는 것은 아닙니다.** 지역 검색 API는 호출당 5건 제한이 있으므로 업소별 지점 누락이 있을 수 있습니다.

### NAVER API HUB 요청 사양 (2026)

- 요청 URL: `https://naverapihub.apigw.ntruss.com/search/v1/local`
- 인증 헤더: `X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY`
- 두 비밀은 Google Secret Manager에만 보관합니다. 과거 `openapi.naver.com`의 `X-Naver-Client-Id` 헤더와 혼용하지 않습니다.
