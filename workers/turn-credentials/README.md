# 단둘이 TURN credential Worker

Cloudflare TURN API 토큰을 브라우저에 노출하지 않고 단기 WebRTC 자격 증명을 발급합니다.

필수 Worker 비밀값:

- `TURN_API_TOKEN`: Cloudflare TURN 앱 생성 시 발급된 API 토큰

배포 후 웹 빌드 환경 변수 `VITE_TURN_CREDENTIALS_URL`에 Worker의 `workers.dev` 주소를 등록합니다.
요청자는 Firebase 로그인 토큰과 커플 ID를 보내며, Worker는 Firestore 보안 규칙을 통해 해당 커플 구성원인지 확인합니다.
