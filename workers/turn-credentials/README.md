# 단둘이 TURN credential Worker

Cloudflare TURN API 토큰을 브라우저에 노출하지 않고 단기 WebRTC 자격 증명을 발급합니다.

필수 Worker 비밀값:

- `TURN_API_TOKEN`: Cloudflare TURN 앱 생성 시 발급된 API 토큰

배포 후 GitHub 저장소의 Actions 변수 `VITE_TURN_CREDENTIALS_URL`에 Worker의 공개 HTTPS 주소를 등록합니다.
웹 배포 워크플로가 이 변수를 빌드에 전달합니다. 로컬/네이티브 빌드에도 같은 환경 변수를 설정해야 합니다.
API 토큰은 이 변수나 `VITE_` 변수에 넣지 마세요.

주소가 비어 있으면 TURN 서버 호출을 건너뛰고 직접 연결만 시도합니다. 이 경우 서로 다른 제한된 네트워크 사이의 통화는 여전히 실패할 수 있습니다.
Firebase Hosting 기본 설정에서 미배포 Functions 재작성 규칙을 제거했으며, `functions/`의 이전 대안은 자동 배포되지 않습니다.

요청자는 Firebase 로그인 토큰과 커플 ID를 보내며, Worker는 Firestore 보안 규칙을 통해 해당 커플 구성원인지 확인합니다.
관련 동작은 [Firebase REST 인증 문서](https://firebase.google.com/docs/firestore/use-rest-api#authentication_and_authorization)를 따릅니다.
웹 및 현재 Capacitor Android/iOS 원본만 CORS로 허용하며, CORS와 별개로 모든 발급 요청에서 인증과 멤버십을 확인합니다.

클라이언트는 인증 토큰 취득·응답 본문 처리까지 합쳐 최대 12초만 기다립니다.
계정·커플·서버 주소별로 캐시를 분리하고, 서버가 알린 유효기간을 늘려 사용하지 않습니다.
Worker의 두 외부 요청은 각각 4초로 제한됩니다. 장애 응답에는 비밀값을 포함하지 않습니다.

Worker 무료 요금제와 TURN 중계 트래픽 요금은 별개입니다. 이 코드를 추가하는 것만으로 무료 통화나 배포 완료가 보장되지는 않습니다.
실제 배포 후 두 계정/서로 다른 네트워크에서 음성·영상통화와 취소/재시도를 검증해야 합니다.

검증: `npm run stability:runtime` (외부 계정이나 실제 토큰 없이 실패·지연·계정 전환 상황도 검사)
