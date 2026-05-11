# 코드라운지 Workspace

`zagabi`는 그대로 두고, 새 채점기와 웹 UI는 `swift/` 아래에 분리했습니다.

## 구성

- `backend`: C++ / Swift 채점 API + 프론트 정적 파일 서빙
- `frontend`: 브라우저 코드 작성 및 즉시 채점 UI 소스
- `backend/data/code-lounge.sqlite`: 회원, 세션, 저장 코드가 들어가는 SQLite DB

## 실행

새 사이트 실행:

```bash
cd swift/backend
npm test
lsof -tiTCP:12024 -sTCP:LISTEN | xargs kill -r
npm start
```

## 접속 주소

- 사이트: `http://127.0.0.1:12024/`
- 헬스체크: `http://127.0.0.1:12024/health`
- 문제 목록 API: `http://127.0.0.1:12024/problems`

주의:

- `http://127.0.0.1:12014` 는 기존 `zagabi` 서버입니다.
- 새 프론트 사이트는 `12014` 가 아니라 `12024` 에서 열립니다.
- 지금은 `swift/backend` 가 `swift/frontend` 정적 파일도 함께 서빙하므로 프론트를 따로 실행할 필요가 없습니다.

## 프론트 개발

프론트 소스 수정이 필요하면 아래 경로를 사용합니다.

```bash
cd swift/frontend
```

## API

- `GET /health`
- `GET /me`
- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /problems`
- `GET /problems/:id`
- `GET /problems/:id/code?language=swift`
- `PUT /problems/:id/code?language=swift`
- `DELETE /problems/:id/code?language=swift`
- `POST /judge`
- `GET /admin/users`
- `PATCH /admin/users/:id`
- `DELETE /admin/users/:id`

## 회원 기능

- 첫 회원가입 계정은 자동으로 `admin` 권한이 부여됩니다.
- 이후 가입 계정은 기본적으로 `user` 권한입니다.
- 저장된 풀이 코드는 회원별 / 문제별 / 언어별로 SQLite에 저장됩니다.
- 현재 회원 기능과 저장 코드 흐름은 메인 목록 + `problemv3` 상세 화면 기준으로 연결되어 있습니다.

## data 폴더 설명

`swift/backend/data`는 회원, 세션, 저장 코드를 보관하는 SQLite 저장 폴더입니다.

- `code-lounge.sqlite`
  메인 데이터베이스 본체 파일입니다.
- `code-lounge.sqlite-wal`
  최근 쓰기 작업이 먼저 기록되는 WAL 로그 파일입니다.
- `code-lounge.sqlite-shm`
  WAL 모드에서 SQLite 내부 상태를 관리하는 보조 파일입니다.

동작 흐름은 이렇습니다.

1. 회원가입, 로그인, 코드 저장 같은 쓰기 작업이 발생하면 변경사항이 먼저 `code-lounge.sqlite-wal`에 기록됩니다.
2. 중간에 조회가 들어오면 SQLite가 `code-lounge.sqlite`와 `code-lounge.sqlite-wal`을 함께 참고해 최신 상태를 반환합니다.
3. 이후 특정 시점에 WAL 로그 내용이 메인 `code-lounge.sqlite` 파일로 병합됩니다.

즉 이 3개는 각각 따로 노는 파일이 아니라, `메인 DB + 쓰기 로그 + 로그 운영 보조 파일` 세트로 함께 동작합니다.

요청 예시:

```json
{
  "problemId": 1001,
  "language": "swift",
  "sourceCode": "import Foundation\nlet nums = readLine()!.split(separator: \" \").compactMap { Int($0) }\nprint(nums[0] + nums[1])\n"
}
```
