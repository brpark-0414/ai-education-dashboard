# 교육 만족도 대시보드

첫 화면에서 **현재 진행 중인 교육**을 고르면, 그 교육의 만족도 대시보드가 열립니다. (정적 사이트 — GitHub Pages에 그대로 올리면 됩니다)

## 구성

| 파일 | 역할 |
|---|---|
| `index.html`, `app.js`, `styles.css` | 화면(교육 목록 + 교육별 대시보드) |
| `data/courses.js` | **교육 목록**. `status: 'active'`이면 "현재 진행 중인 교육", 그 외는 "지난 교육" |
| `data/leader.js`, `data/advanced.js` | 응답 데이터 스냅샷 |
| `apps-script/Code.gs` | 시트 → JSON 웹 앱 (라이브 연동용) |
| `vendor/chart.umd.min.js` | Chart.js (외부 CDN 불필요) |

주소: `…/index.html#/leader`, `…/index.html#/advanced` 처럼 교육별 링크를 바로 공유할 수 있습니다.

## 데이터 최신화 (AI 리더 교육)

시트(`[인재개발팀] AI 리더 교육 만족도 조사(응답)`)는 비공개라서 사이트가 직접 읽을 수 없습니다. 아래 한 번만 설정하면 화면의 **🔄 최신 데이터 가져오기** 버튼이 활성화됩니다.

1. 응답 시트 → 확장 프로그램 → Apps Script → `apps-script/Code.gs` 붙여넣기
2. 배포 → 새 배포 → 웹 앱 (실행: 나 / 액세스: 모든 사용자)
3. 발급된 `…/exec` URL을 `data/courses.js`의 `leader.apiUrl`에 입력

> 웹 앱 URL을 아는 사람은 응답 데이터(이메일 ID 포함)를 볼 수 있으니 공개 범위에 유의하세요.

## 새 교육 추가

1. `data/<이름>.js` 에 `window.XXX_RAW = [...]` 형태로 응답 데이터 작성 (필드: `session, name, email, q1~q5, avg, help, improve`)
2. `index.html`에 `<script src="data/<이름>.js">` 추가
3. `data/courses.js`에 항목 추가 (`dataVar`에 `XXX_RAW` 지정)

회차명이 `9/8 (화) A조 1회` 형태이면 조(A/B) 필터가 자동으로 생깁니다.

## 로컬 확인

```bash
python -m http.server 8765
```
