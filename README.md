# 교육 만족도 대시보드

첫 화면에서 **현재 진행 중인 교육**을 고르면 그 교육의 만족도 대시보드가 열립니다. (정적 사이트 — GitHub Pages)

## 구성

| 파일 | 역할 |
|---|---|
| `index.html`, `app.js`, `styles.css` | 화면(교육 목록 + 교육별 대시보드) |
| `data/courses.js` | 교육 목록과 요약. `status: 'active'`이면 "현재 진행 중인 교육", 그 외는 "지난 교육" |
| `data/leader.js`, `data/advanced.js` | 응답 스냅샷. **이름·이메일을 제거**하고 순서를 섞은 공개용 데이터 |
| `vendor/chart.umd.min.js` | Chart.js |
| `apps-script/Code.gs` | (선택) 시트 실시간 연동 + Claude 분석용 서버 코드. 현재는 사용하지 않음 |

개인을 식별할 수 있는 정보(이메일·이름·개인별 추이·순위)는 화면에도 데이터에도 없습니다.

## 데이터 갱신

현재 두 교육 모두 스냅샷입니다. 새 응답이 생기면 `data/*.js`를 다시 만들어 교체하세요.
(스냅샷에 이름·이메일을 넣지 마세요.)

실시간 연동이 필요해지면 `apps-script/Code.gs`를 시트에 배포하고 `courses.js`의 `apiUrl`에 URL을 넣으면 됩니다.
이 코드는 서버에서 개인 정보를 제거하고, Claude 요약·주제 분류와 관리자 화면(`#/<교육>/admin`)을 제공합니다.
(스크립트 속성 `ANTHROPIC_API_KEY`, `ADMIN_TOKEN` 필요)

## 로컬 확인

```bash
python -m http.server 8765
```
