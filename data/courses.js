// 교육 목록. status: 'active'(현재 진행 중) | 'ended'(지난 교육)
// apiUrl 이 있으면 Apps Script(실시간·Claude 분석), 없으면 dataVar 의 스냅샷을 사용합니다.
window.COURSES = [
  {
    "id": "leader",
    "title": "AI 리더 교육",
    "tagline": "Claude Skill · 바이브코딩 · 디자인/데이터 활용 실습",
    "eyebrow": "인재개발팀 · AI 리더 교육",
    "status": "active",
    "dataVar": null,
    "apiUrl": "https://script.google.com/macros/s/AKfycbxpt0Y7kFySoD_oX64ZcOE6TMAVvkYGnrZ-16LDxUhcPVtMmngMSHsqWMDrF5EmOcRI/exec",
    "upcoming": [
      "10/2 (금) B조 3회"
    ],
    "summary": null
  },
  {
    "id": "advanced",
    "title": "AI 심화 교육",
    "tagline": "회차별 만족도 추이와 개인별 문항 점수 변화",
    "eyebrow": "인재개발팀 · AI 심화 교육",
    "status": "ended",
    "dataVar": "ADVANCED_RAW",
    "apiUrl": "",
    "upcoming": [],
    "summaryDate": "2026-08-19",
    "summary": "<div class=\"ai-block\">\n        <h3>설문조사 전반적인 의견</h3>\n        <p>5개 회차 평균 만족도는 4.3~4.8점(5점 만점) 수준으로 전반적으로 높은 편입니다. 다만 8/5(Skill 만들기) 회차에서 전 문항 평균이 3.9~4.3점까지 떨어지며 뚜렷한 저점을 기록했고, 8/12 회차에 실습키트·체크리스트가 도입된 이후 다시 4.5점 이상으로 회복하는 흐름을 보였습니다. 응답자 수는 7/29 21명을 정점으로 8/12(11명), 8/19(13명)에는 절반 가까이 줄어, 회차가 진행될수록 참여 인원이 감소하는 경향도 함께 나타났습니다.</p>\n      </div>\n      <div class=\"ai-block\">\n        <h3>다음 교육에 반영하면 좋을 점</h3>\n        <ul>\n          <li>실습 난이도가 급격히 올라가는 구간(8/5 Skill 실습과 같은 회차)은 속도를 늦추거나 단계를 세분화하는 것을 검토</li>\n          <li>실습 결과가 맞는지 스스로 점검할 수 있는 체크포인트나 정답 예시를 각 실습 단계에 포함</li>\n          <li>발표 화면 해상도/폰트 크기 개선 (여러 회차에서 반복 제기된 사항)</li>\n          <li>비용이 발생하는 개념(API 등)을 설명할 때는 이전 회차 내용과의 관계를 먼저 명확히 안내</li>\n          <li>조별 과제는 목적·평가 기준·제출물 형태를 사전에 구체적으로 공지</li>\n          <li>8/12 회차의 체크리스트·실습키트 방식이 효과적이었던 만큼, 남은 회차에도 유사한 형태를 유지·확대하는 것을 권장</li>\n        </ul>\n      </div>",
    "uniquePeopleVar": "ADVANCED_UNIQUE_PEOPLE"
  }
];
