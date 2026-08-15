# 사이

> 너와 나 사이, 둘 사이의 이야기가 머무는 작은 창구.

**사이**는 연인 두 사람이 대화하고 추억을 남기며 둘 사이의 시간을 이어가는 모바일 중심 비공개 공간 MVP입니다. React, TypeScript, Vite로 구성했습니다.

## 실행 방법

```bash
npm install
npm run dev
```

개발 서버가 안내하는 `http://localhost:5173`을 브라우저에서 엽니다. 프로덕션 빌드는 `npm run build`, 빌드 미리보기는 `npm run preview`를 사용합니다. 현재 UI MVP는 별도 환경변수 없이 실행되며 백엔드 연동 예시는 `.env.example`에 있습니다.

## 구현 범위

- 로그인, 회원가입, 초대 코드 복사·입력 및 커플 연결 데모
- 상대방 이름, 함께한 날짜, 가장 가까운 기념일, 최근 추억과 메시지를 보여주는 홈
- 현재 날짜를 기준으로 반복 기념일과 다음 100일 단위 기념일을 자동 계산하고 정렬
- 날짜 구분, 읽음 상태, 답장, 이모지 반응, 중요 메시지 저장, 사진 전송·확대 보기를 지원하는 1:1 채팅
- 전체·즐겨찾기·연도 필터와 상세 갤러리를 제공하는 반응형 추억 보관함
- 사진 미리보기를 포함한 추억 추가·수정·삭제 및 즐겨찾기
- 과거 같은 날짜의 추억을 홈에 보여주는 `1년 전 오늘`
- 전체 기념일과 남은 날짜 목록
- 모바일 하단 탭 내비게이션과 데스크톱 앱 프레임
- 수달 캐릭터 `사(SA)`와 `이(I)`를 활용한 브랜드 Hero, 상태·빈 화면, 연결 완료 경험
- 데모 토스트와 캐릭터 상태 매핑을 포함한 빠른 신호 UI 및 `localStorage`에 내 기분을 유지하는 `오늘의 사이` 영역

현재 인증·초대는 핵심 경험 검증을 위한 클라이언트 데모입니다. 채팅, 추억과 내 기분은 브라우저 `localStorage`에 저장되지만, 실제 계정 간 동기화와 서버 기반 실시간 통신은 백엔드 연동이 필요합니다.

## 프로젝트 구조

```text
src/
├── components/
│   ├── chat/     # 채팅 버블, 작성창, 반응 선택과 채팅 화면
│   ├── characters/ # 캐릭터 렌더러와 상태별 asset 설정
│   └── memories/ # 추억 카드, 폼, 상세 화면과 목록
├── assets/characters/ # 사, 이, 커플 캐릭터 SVG placeholder
├── utils/        # 날짜 표시와 localStorage 저장 어댑터
├── App.tsx       # 앱 화면 전환, 홈과 기념일
├── types.ts      # 채팅과 추억 도메인 타입
├── main.tsx      # React 진입점
└── styles.css    # 사이 브랜드 디자인 토큰과 반응형 스타일
```

## 캐릭터 asset 교체

현재 캐릭터는 외부 이미지를 사용하지 않는 교체 가능한 SVG placeholder입니다. 실제 PNG/WebP가 준비되면 `src/assets/characters/sa`, `src/assets/characters/i`, `src/assets/characters/couple`에 추가하고 `src/components/characters/characterConfig.ts`의 import만 변경하면 됩니다. 상태별 파일명은 `couple-love`, `couple-miss`, `couple-hug`, `couple-cheer`, `couple-anniversary`, `couple-memory` 형식을 사용합니다.

## 보안 설계 (백엔드 연동 시 필수)

모든 커플 소유 데이터에는 `couple_id`를 저장하고 클라이언트가 아닌 서버가 인증 토큰의 사용자로부터 이를 결정해야 합니다. API 쿼리는 항상 로그인 사용자의 `couple_id` 조건을 강제하며, 초대 코드는 단일 사용·만료·해시 저장합니다. WebSocket 채널 참가 역시 서버가 인증 후 동일 `couple_id`의 두 사용자에게만 허용해야 합니다. 사진은 비공개 스토리지에 저장하고 동일 권한 검사를 거친 짧은 만료 시간의 서명 URL로만 제공합니다.

> 저장소의 데모 데이터는 브라우저 UI에 포함된 샘플이며 실제 개인정보를 저장하지 않습니다. 실제 서비스 배포 전 인증·인가 백엔드 구현이 필요합니다.
