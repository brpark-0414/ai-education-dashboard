/**
 * 구글 시트(설문 응답)를 대시보드가 읽을 수 있는 JSON으로 내려주는 웹 앱.
 *
 * 사용법
 * 1) 응답 시트에서 [확장 프로그램 > Apps Script] 를 열고 이 코드를 붙여넣기
 * 2) [배포 > 새 배포 > 유형: 웹 앱] → 실행 계정: 나 / 액세스: 모든 사용자 → 배포
 * 3) 발급된 웹 앱 URL(…/exec)을 data/courses.js 의 해당 교육 apiUrl 에 넣기
 *
 * 시트 열 순서(구글 폼 응답 시트 기본):
 *  A 타임스탬프 | B 이메일 | C 교육 일자(회차) | D~G 문항 Q1~Q4 | H 전반적 만족도(Q5) | I 도움된 부분 | J 개선 요청
 */
const SHEET_NAME = '설문지 응답 시트1';

function doGet() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const email = String(r[1] || '').trim();
    const session = String(r[2] || '').trim();
    const q = [r[3], r[4], r[5], r[6], r[7]].map(Number);
    // 요약 행(이메일 없음)·미래 회차(#DIV/0!)·비정상 값은 제외
    if (!email || !session || q.some(n => !(n >= 1 && n <= 5))) continue;

    const id = email.split('@')[0];
    out.push({
      session: session,
      name: id,
      email: id,
      q1: q[0], q2: q[1], q3: q[2], q4: q[3], q5: q[4],
      avg: Math.round(q.reduce((a, b) => a + b, 0) / 5 * 10) / 10,
      help: String(r[8] || '').trim(),
      improve: String(r[9] || '').trim()
    });
  }

  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
