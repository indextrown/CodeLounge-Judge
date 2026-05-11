# 코드라운지 Workspace

`zagabi`는 그대로 두고, 새 채점기와 웹 UI는 `swift/` 아래에 분리했습니다.

## 구성

- `backend`: C++ / Swift 채점 API + 프론트 정적 파일 서빙
- `frontend`: 브라우저 코드 작성 및 즉시 채점 UI 소스

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
- `GET /problems`
- `GET /problems/:id`
- `POST /judge`

요청 예시:

```json
{
  "problemId": 1001,
  "language": "swift",
  "sourceCode": "import Foundation\nlet nums = readLine()!.split(separator: \" \").compactMap { Int($0) }\nprint(nums[0] + nums[1])\n"
}
```
