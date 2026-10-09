# browser-core 0.12 (실험 버전)

Chromium, Edge/WebView2, Firefox를 쓰지 않는 Rust 자체 HTML/CSS 엔진입니다.
목표는 적은 메모리로 일상적인 웹사이트를 이용하고, 운영체제로 렌더러 권한을 제한하는 브라우저입니다.
**현재는 정적 문서를 읽는 실험 버전이며, 크롬·엣지 대체품은 아닙니다.**

## Windows에서 실행

1. `browser-core-windows-x64.zip`을 압축 해제합니다.
2. `run-browser.cmd` 또는 `browser-core.exe`를 실행합니다.
3. `browser-core.exe`와 `browser-renderer.exe`는 같은 폴더에 두세요.

Windows 실행 파일은 `browser-engine` 브랜치의 **Browser Engine CI**가 테스트 후 생성합니다.
Actions의 해당 실행에서 `browser-core-windows-x64` artifact를 받으면 ZIP과 SHA256을 확인할 수 있습니다.
서명된 설치 프로그램이나 자동 업데이트는 아직 제공하지 않습니다.

Windows x64 배포본은 C 런타임을 실행 파일에 정적으로 연결하며 별도의 Visual C++ 런타임 설치를 요구하지 않습니다. CI는 두 EXE의 DLL 의존성을 검사한 뒤 ZIP에서 다시 압축 해제한 파일로 렌더러 실행을 검증합니다.
직접 Windows에서 빌드할 때는 `cargo build --locked --release --bins --target x86_64-pc-windows-msvc`를 사용하세요. 결과는 `target/x86_64-pc-windows-msvc/release/`에 생성됩니다.

## 사용법

| 동작 | 단축키 / 버튼 |
| --- | --- |
| 주소 또는 검색어 입력 | Ctrl+L, 주소창 클릭 |
| 주소 전체 교체 | Ctrl+A, 새 입력 |
| 붙여넣기 | Ctrl+V (Windows) |
| 새 탭 / 닫기 | Ctrl+T / Ctrl+W, + / X |
| 다음 / 이전 탭 | Ctrl+Tab / Ctrl+Shift+Tab, 번호 클릭 |
| 뒤로 / 앞으로 | Alt+← / Alt+→, < / > |
| 다시 불러오기 | F5 또는 Ctrl+R, R |
| 시작 페이지 | Alt+Home, H |
| 북마크 추가·제거 / 목록 | Ctrl+D / Ctrl+B, 주소창 옆 + 또는 * |
| 로딩 취소 / 주소 편집 취소 | Esc |
| 세션 쿠키 삭제 후 시작 페이지 | Ctrl+Shift+Delete |
| 스크롤 | 휠, ↑↓, PageUp/PageDown, Home/End |

검색어는 **Enter를 눌렀을 때만 Google 검색으로 전송**합니다. 주소창 자동완성·키 입력 전송은 없습니다.
주소는 HTTPS만 허용하고, 내장 계정 정보·파일·스크립트 주소와 비 HTTPS 리디렉션을 차단합니다.
현재 네트워크는 HTTP/1.1과 identity·gzip·zlib deflate 응답을 지원합니다. Brotli와 HTTP/2는 아직 지원하지 않습니다. 압축 전·후 각각 리소스 바이트 한도를 검사합니다.

## 0.12 세션 쿠키

- 브로커 작업자에만 메모리 쿠키 저장소를 둡니다. 탭끼리 같은 저장소를 사용하며 재시작 시 모두 폐기합니다. 렌더러에 Cookie/Set-Cookie를 전달하지 않습니다.
- 쿠키 개수 128개, 저장 문자열 합계 64 KiB, 개별 Set-Cookie 4096바이트, 요청 Cookie 헤더 16 KiB로 제한합니다.
- 경로·만료/삭제·Max-Age 우선순위·Secure 이름 접두사와 헤더 문자 검사를 적용합니다.
- 출처(호스트+포트)를 같게 제한합니다. Domain을 지정해도 다른 서브도메인으로 공유하지 않습니다. 공개 접미사·등록 도메인 단위의 완전한 쿠키 구현은 아직 아닙니다.
- 다른 출처의 하위 리소스에는 쿠키를 보내거나 저장하지 않습니다. 다른 출처에서 시작한 POST에도 쿠키를 보내지 않습니다. Strict 쿠키는 같은 출처 요청에만, Lax는 교차 출처의 최상위 GET에도 허용합니다.
- Ctrl+Shift+Delete로 진행 중 요청을 취소하고 쿠키 삭제를 작업자에게 우선 전달한 뒤 시작 페이지로 이동합니다.
- 실제 로컬 TLS 서버에서 POST 로그인→303→쿠키가 필요한 페이지 접근→쿠키 삭제→401 흐름을 검증했습니다. 일반 사이트의 로그인이나 SSO 호환성을 인증한 결과는 아닙니다.
- 기본 정적 폼의 세션 유지 기반을 추가했습니다. JavaScript·DOM 이벤트·SSO·전체 폼과 브라우저 정책 호환성은 미완성입니다.

## 0.11 추가 구현

- 텍스트·검색·비밀번호 입력창, hidden 값, 체크박스, 제출 버튼, textarea의 기본 값을 표시하고 처리합니다.
- 입력창 클릭·Tab/Shift+Tab 이동·Ctrl+A·Backspace·Ctrl+V·한글 입력·Enter/버튼 제출을 연결했습니다.
- GET 검색과 URL-encoded POST를 지원합니다. 반복된 필드 이름과 한글·특수문자·줄바꿈을 인코딩합니다.
- required·disabled·readonly·maxlength와 입력 바이트 한도를 검사합니다. 전체 HTML5 입력 검증은 아닙니다.
- 비밀번호는 화면에서 가리고 GET URL 또는 다른 출처로의 비밀번호 전송을 차단합니다. 출처가 바뀌는 POST 유지 리디렉션도 차단합니다.
- POST 본문은 탭·이력·디스크에 저장하지 않습니다. POST 결과의 새로고침·이력/탭 복원은 안내 화면으로 처리하며 자동 재전송하지 않습니다.
- 렌더러가 전달한 폼 정보는 별도 IPC 개수·문자열·태그 한도로 검증합니다. 폼 256개/문자열 합계 256 KiB, 입력 4096바이트/필드, POST 본문 64 KiB입니다.
- 라디오·select·파일 첨부·number/date 등 미지원 컨트롤이 있는 폼과 multipart 등의 인코딩은 제출하지 않고 이유를 표시합니다.
- 입력창은 끝에 입력/삭제하는 기본 편집입니다. 커서 이동·범위 선택·여러 줄 textarea 편집은 아직 지원하지 않습니다.
- **이 폼 구현만으로 일반 사이트의 로그인 유지나 동적 검색을 지원한다는 의미는 아닙니다. 쿠키 범위는 위의 0.12 항목을 참조하세요.**

## 0.10 추가 구현

- 스크롤이 매 프레임 맨 위로 되돌아가던 조건 오류를 수정했습니다. 휠·키보드 스크롤 위치를 유지합니다.

- HTML·CSS·이미지의 gzip/zlib deflate 응답을 해제합니다. 압축 폭탄, 손상된 체크섬, 중복·미지원 인코딩은 거부합니다.
- TLS 인증서 검증 설정은 재사용해 요청마다 루트 인증서 목록을 재구성하지 않습니다.
- HTTP 헤더 이름·제어문자·Content-Length 문법을 검사합니다.
- 따옴표 없는 URL과 첫 번째 중복 속성을 유지하고, 일부 생략된 p/li/dt/dd/td/th/tr/option 닫기 태그를 처리합니다.
- script/style 종료 태그를 정확히 구분하고, 일반 HTML 요소의 잘못된 self-closing 표기를 처리합니다.
- 엔티티 검사에 유한 탐색 범위를 적용해 반복된 & 입력의 처리 시간을 줄입니다.
- CSS 하위·자식 선택자를 16개 연결까지 지원하고, 재귀적 역추적 없이 조상 후보를 검사합니다.
- !important와 ID·클래스·태그 우선순위를 반영합니다. 미지원 @media 등은 전체 블록을 건너뜁니다.
- Unicode가 들어간 잘못된 hex 색상에서 발생하던 문자열 경계 panic을 차단했습니다.

## 기존 구현

- 로딩을 단일 백그라운드 작업으로 이동해 창과 탭 조작을 계속 처리합니다.
- 로딩 세대와 탭 ID를 검사해 취소한 결과·다른 탭의 결과가 표시되지 않게 합니다.
- 최대 16개 탭, 탭마다 최대 256개 URL 이력과 스크롤 위치를 유지합니다.
- 비활성 탭은 DOM·이미지·렌더러를 저장하지 않습니다. 탭을 다시 선택하면 페이지를 다시 불러옵니다.
- 프레임버퍼를 재사용하고 IPC에 HTML을 복제하지 않아 불필요한 메모리를 줄입니다.
- OS 글꼴에서 필요한 글자만 그립니다. 글자 비트맵 캐시는 최대 256개입니다.
- 한글 문자 입력과 Windows UTF-16 문자 쌍을 처리합니다. IME 조합 중 표시·후보 위치는 아직 실기기 검증이 필요합니다.
- 빠르게 눌렀다 뗀 단축키도 이벤트로 처리합니다.
- 북마크는 최대 128개로 제한해 로컬 파일에 저장합니다. 로그인 쿠키·비밀번호·방문 기록은 디스크에 저장하지 않습니다. 세션 쿠키는 브로커 메모리에만 둡니다.
- 네트워크 작업에 취소·30초 예산을 적용하고, 멈춘 렌더러는 별도 감시 장치로 종료합니다.
- HTTP 본문 중단·중복 길이·모호한 전송 형식을 거부합니다.
- IPC 문자열의 전체 예산에 링크를 포함하고 이미지 크기·픽셀 수·글자 크기를 검증합니다.

## 보안 경계

브로커는 UI·HTTPS·북마크·최종 화면 그리기를 담당합니다. 별도 렌더러는 HTML/DOM/CSS·이미지 해석·레이아웃만 처리합니다.
렌더러에는 네트워크, UI, 클립보드, 북마크 코드가 포함되지 않습니다.

Windows에서는 제한된 프로세스 토큰, 콘텐츠 처리 전 Low Integrity, Job Object를 사용합니다.
DLL/CRT 초기화 동안 최초 스레드만 임시 시작 토큰으로 실행합니다. 렌더러는 READY 전에 `RevertToSelf`로 이를 폐기하며, 브로커도 해당 스레드의 토큰이 제거됐는지 확인합니다. 이 확인과 Low Integrity/UI 제한 적용이 모두 성공한 뒤에만 문서 바이트를 전송합니다. 실패하면 렌더러를 종료하며 일반 권한 실행으로 우회하지 않습니다.
Job은 메모리 192 MiB, 사용자 CPU 10초, 자식 프로세스 금지, 클립보드/UI 제한, 브로커 종료 시 렌더러 종료를 적용합니다.
보안 설정 실패 시 문서를 전달하지 않습니다. IPC에 일반 명령 실행 기능은 없습니다.

**AppContainer는 아직 아닙니다.** Windows가 렌더러의 모든 파일 읽기·네트워크 호출을 완전히 막고 있지는 않습니다.
Linux 실행은 개발용이며 Windows 권한 격리를 제공하지 않습니다.
OS 강제 네트워크 차단과 파일 접근 허용 목록이 적용되기 전까지 높은 보안의 일상용 브라우저라고 주장하지 않습니다.

## 아직 지원하지 않는 기능

JavaScript·DOM 이벤트, 전체 HTML5 폼·라디오·select·파일 첨부, 완전한 쿠키 정책·SSO·일반 사이트 로그인, Flex/Grid 등 일반 사이트의 CSS,
웹폰트·복잡한 문자 shaping·선택/복사, 영상·음성·확장 기능, 일반 파일 다운로드,
오프라인 캐시·전체 세션 복원, 창 크기 변경, 서명·설치 프로그램·업데이트.
Google 검색 주소는 생성하지만 검색 결과 페이지 호환성은 별도 검증 대상입니다.
메모리·보안이 크롬 또는 엣지보다 우수하다는 비교 결과는 아직 없습니다.

## 개발·검증

```text
cargo fmt --check
cargo check --locked --all-targets
cargo test --locked --all-targets
cargo build --locked --bins
./target/debug/browser-core --sandbox-self-test
./target/debug/browser-core --watchdog-self-test
./target/debug/browser-core --forms-self-test
./target/debug/browser-core --render-file tests/fixtures/reading.html target/reading.ppm
```

Windows에서 위 Cargo 검사·빌드 명령에는 `--target x86_64-pc-windows-msvc`를 추가하고, 실행 경로는 `target\x86_64-pc-windows-msvc\debug\browser-core.exe`로 바꾸세요.
`--render-file`은 명시적으로 선택한 로컬 HTML 검증용 기능이며, 웹페이지가 파일 접근을 요청할 수 있는 기능이 아닙니다.
글꼴은 Windows `malgun.ttf`, Linux Nanum/Noto/DejaVu 순으로 찾습니다.
개발자는 `BROWSER_CORE_FONT` 환경 변수로 신뢰하는 로컬 글꼴을 지정할 수 있습니다. 웹폰트는 읽지 않습니다.

검증 결과와 실사용 완료 기준: [docs/STATUS.md](docs/STATUS.md).

### 실제 HTTPS 경로 진단

```powershell
.\browser-core.exe --render-url https://example.com/ example.ppm
```

주소 해석·TLS 인증서 검증·HTTP 수신·제한 렌더러 처리·그리기 결과 생성까지 같은 코드 경로로 실행합니다. 네트워크 접근이 가능한 환경에서 사용하며, GUI 조작·로그인·JavaScript 호환성을 검증하는 명령은 아닙니다.
