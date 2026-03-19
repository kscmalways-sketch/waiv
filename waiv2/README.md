# waiv — AI Workflow Orchestrator

> ai사용이 막막 하실 때 ai로 무엇을 하고 싶은지 알려주세요  
> made by jaeha

waiv는 사용자의 목표를 입력받아 맞춤형 질문 세트와 단계별 AI 로드맵 + 프롬프트를 자동 생성해주는 웹앱입니다.  
**Gemini**가 질문 생성과 로드맵 생성을 모두 담당합니다.

---

## 빠른 시작

```bash
# 1. 압축 해제 후 폴더 진입
cd waiv

# 2. 패키지 설치
npm install

# 3. 환경변수 설정
cp .env.example .env
# .env 파일을 열고 GEMINI_API_KEY 입력

# 4. 실행
npm start
# → http://localhost:3000
```

---

## 환경변수

| 변수명 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `GEMINI_API_KEY` | ✅ | — | Google AI Studio에서 발급 |
| `GEMINI_MODEL` | ❌ | `gemini-1.5-flash` | 모델 변경 시 사용 |
| `PORT` | ❌ | `3000` | 서버 포트 |

API 키 발급: https://aistudio.google.com/app/apikey

---

## Railway / Render 배포

1. GitHub에 push
2. Railway 또는 Render에서 새 프로젝트 → 저장소 연결
3. 환경변수에 `GEMINI_API_KEY` 입력
4. 배포 완료 (Start Command: `npm start`)

---

## 구조

```
waiv/
├── server.js        # Express 서버 + Gemini API 호출
├── package.json
├── .env.example
├── .gitignore
├── README.md
└── public/
    └── index.html   # 프론트엔드 전체 (단일 파일)
```

---

## API 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| POST | `/api/questions` | 목표 분석 + 맞춤 질문 생성 |
| POST | `/api/roadmap` | 단계별 로드맵 + 프롬프트 생성 |
