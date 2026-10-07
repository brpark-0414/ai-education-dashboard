/**
 * 교육 만족도 — 시트 → JSON 웹 앱 + Claude 분석(요약·주제 분류)
 *
 * 공개(GET)   : 개인을 식별할 수 있는 정보(이메일·이름·응답 순서·식별 가능 의견)를 모두 제외한 데이터 + Claude 분석
 * 관리자(POST): ADMIN_TOKEN 이 맞을 때만 이메일을 포함한 전체 데이터 + 참석자별 분석
 *
 * 설정 (Apps Script ▸ 프로젝트 설정 ▸ 스크립트 속성)
 *   ANTHROPIC_API_KEY : Anthropic API 키   (브라우저 코드에는 절대 넣지 않습니다)
 *   ADMIN_TOKEN       : 관리자 화면 비밀번호 (길고 추측하기 어려운 문자열)
 *
 * 응답 탭은 헤더 문구로 자동 인식합니다(아래 COLS). 탭이 여러 개여도 모두 합칩니다.
 */
const MODEL = 'claude-sonnet-5-5';
const MIN_N = 5;                       // 응답이 이보다 적은 회차는 공개 화면에서 의견 원문을 숨김
const COOLDOWN_MS = 10 * 60 * 1000;    // 새 응답이 있어도 Claude 재분석은 최소 10분 간격
const CLASSIFY_CHUNK = 60;             // 한 번에 분류할 응답 수
const TOPICS = [
  '진행 속도', '실습 시간·비중', '난이도', '시간·일정 운영', '강의 자료·사후 복습',
  '실습 환경·계정·설치', '보안·권한 가이드', '강의실 환경(좌석·화면·조명)', '강사·보조 지원',
  '교육 주제·콘텐츠', '사례·예시', '과제·평가 안내', '기타'
];

// ------------------------------------------------------------------ 진입점
function doGet() {
  return json_(publicPayload_(analyze_(false)));
}

function doPost(e) {
  let req = {};
  try { req = JSON.parse(e.postData.contents); } catch (_) {}
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('ADMIN_FAILS') || 0);
  if (fails >= 10) return json_({ error: 'locked' });          // 10회 실패 시 10분 잠금

  const token = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (!token || !safeEqual_(String(req.token || ''), token)) {
    cache.put('ADMIN_FAILS', String(fails + 1), 600);
    return json_({ error: 'unauthorized' });
  }
  const analysis = analyze_(req.action === 'regenerate');
  return json_(adminPayload_(analysis));
}

// ------------------------------------------------------------------ 시트 읽기
// 탭 이름에 의존하지 않고, 헤더에 아래 키워드가 모두 있는 탭(구글 폼 응답 탭)을 전부 읽어 합칩니다.
// 응답 탭이 여러 개로 나뉘어 있어도 동작합니다. 요약표·메모용 탭은 헤더가 달라 자동으로 제외됩니다.
const COLS = {
  email:   ['이메일'],
  session: ['교육 일자'],
  q1:      ['커리큘럼'],
  q2:      ['시간 및 일정'],
  q3:      ['실제 업무'],
  q4:      ['난이도'],
  q5:      ['전반적인 교육의 만족도'],
  help:    ['도움이 되었던'],
  improve: ['개선되었으면']
};

function mapHeader_(header) {
  const map = {};
  for (const key in COLS) {
    const i = header.findIndex(h => COLS[key].some(k => String(h).indexOf(k) >= 0));
    if (i < 0) return null;
    map[key] = i;
  }
  return map;
}

function responseSheets_() {
  const out = [];
  SpreadsheetApp.getActive().getSheets().forEach(sh => {
    if (sh.getLastRow() < 2) return;
    const values = sh.getDataRange().getValues();
    const map = mapHeader_(values[0]);
    if (map) out.push({ name: sh.getName(), values: values, map: map });
  });
  return out;
}

function readRows_() {
  const rows = [];
  responseSheets_().forEach(sh => {
    for (let i = 1; i < sh.values.length; i++) {
      const r = sh.values[i], m = sh.map;
      const email = String(r[m.email] || '').trim();
      const session = String(r[m.session] || '').trim();
      const q = [r[m.q1], r[m.q2], r[m.q3], r[m.q4], r[m.q5]].map(Number);
      // 요약 행(이메일 없음)·미래 회차(#DIV/0!)·비정상 값 제외
      if (!email || !session || q.some(n => !(n >= 1 && n <= 5))) continue;
      rows.push({
        idx: rows.length,
        email: email,
        id: email.split('@')[0],
        session: session,
        q1: q[0], q2: q[1], q3: q[2], q4: q[3], q5: q[4],
        avg: Math.round(q.reduce((a, b) => a + b, 0) / 5 * 10) / 10,
        help: String(r[m.help] || '').trim(),
        improve: String(r[m.improve] || '').trim()
      });
    }
  });
  return rows;
}

// ------------------------------------------------------------------ 응답 구성
function sessionCounts_(rows) {
  const n = {};
  rows.forEach(r => { n[r.session] = (n[r.session] || 0) + 1; });
  return n;
}

function baseRow_(r, cls) {
  return {
    session: r.session, q1: r.q1, q2: r.q2, q3: r.q3, q4: r.q4, q5: r.q5, avg: r.avg,
    ht: (cls && cls.h) || [], it: (cls && cls.b) || []
  };
}

function publicPayload_(analysis) {
  const rows = readRows_();
  const counts = sessionCounts_(rows);
  const cls = (analysis && analysis.cls) || {};
  const out = rows.map(r => {
    const c = cls[r.idx];
    // 분류(식별 정보 검사)가 끝난 응답만 원문 공개. 미분류·식별 가능·소규모 회차는 숨김
    const hide = !c || c.x || counts[r.session] < MIN_N;
    const o = baseRow_(r, c);
    o.help = hide ? '' : r.help;
    o.improve = hide ? '' : r.improve;
    o.hid = !!((r.help || r.improve) && hide);
    return o;
  });
  shuffle_(out);   // 시트 입력 순서(=제출 시각 순서)로 사람을 유추하지 못하게 섞음
  return {
    rows: out,
    meta: {
      total: rows.length,
      uniquePeople: new Set(rows.map(r => r.email.toLowerCase())).size,
      analyzedAt: analysis ? analysis.at : null
    },
    insights: analysis && analysis.pub ? { overall: analysis.pub.overall, nextSteps: analysis.pub.nextSteps } : null
  };
}

function adminPayload_(analysis) {
  const rows = readRows_();
  const cls = (analysis && analysis.cls) || {};
  const out = rows.map(r => {
    const o = baseRow_(r, cls[r.idx]);
    o.name = r.id; o.email = r.email; o.help = r.help; o.improve = r.improve;
    return o;
  });
  let insights = null;
  if (analysis && analysis.pub) {
    const idOf = {};
    rows.forEach(r => { idOf[anonId_(rows, r.email)] = r.id; });
    insights = {
      overall: analysis.pub.overall,
      nextSteps: analysis.pub.nextSteps,
      participants: (analysis.adm || []).map(t => String(t).replace(/P\d{2}/g, m => idOf[m] || m))
    };
  }
  return {
    admin: true,
    rows: out,
    meta: {
      total: rows.length,
      uniquePeople: new Set(rows.map(r => r.email.toLowerCase())).size,
      analyzedAt: analysis ? analysis.at : null
    },
    insights: insights
  };
}

// ------------------------------------------------------------------ Claude 분석
function analyze_(force) {
  const props = PropertiesService.getScriptProperties();
  const cur = loadAnalysis_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return cur;
  try {
    const rows = readRows_();
    if (!rows.length) return cur;          // 읽은 응답이 없으면 Claude를 호출하지 않음(빈 분석 결과 캐시 방지)
    const hash = hash_(rows);
    if (!force && cur && cur.hash === hash) return cur;
    if (!props.getProperty('ANTHROPIC_API_KEY')) return cur;
    const lastTry = Number(props.getProperty('LAST_TRY') || 0);
    if (!force && Date.now() - lastTry < COOLDOWN_MS) return cur;
    props.setProperty('LAST_TRY', String(Date.now()));

    // 1) 주관식 응답 주제 분류 + 식별 정보 검사
    const withText = rows.filter(r => r.help || r.improve);
    const cls = {};
    for (let s = 0; s < withText.length; s += CLASSIFY_CHUNK) {
      const chunk = withText.slice(s, s + CLASSIFY_CHUNK);
      classify_(chunk).forEach(x => {
        cls[x.i] = { h: cleanTopics_(x.h), b: cleanTopics_(x.b), x: !!x.x };
      });
    }
    // 분류가 누락된 응답은 안전하게 '식별 가능'으로 처리(공개 화면에서 숨김)
    withText.forEach(r => { if (!cls[r.idx]) cls[r.idx] = { h: [], b: [], x: true }; });
    rows.forEach(r => { if (!cls[r.idx]) cls[r.idx] = { h: [], b: [], x: false }; });

    // 2) 요약
    const sum = summarize_(rows);
    const next = {
      hash: hash, at: Date.now(), cls: cls,
      pub: { overall: String(sum.overall || ''), nextSteps: (sum.nextSteps || []).map(String) },
      adm: (sum.participants || []).map(String)
    };
    saveAnalysis_(next);
    return next;
  } catch (err) {
    console.error(err);
    return cur;
  } finally {
    lock.releaseLock();
  }
}

function classify_(chunk) {
  const system =
    '당신은 사내 교육 만족도 설문의 주관식 응답을 분류하는 분석가입니다. 반드시 JSON만 출력합니다.';
  const user =
    '아래 응답을 분류하세요.\n' +
    '주제 목록: ' + TOPICS.join(' / ') + '\n\n' +
    '각 응답마다:\n' +
    '- h: "도움된 부분"에 해당하는 주제 목록(목록에 있는 이름만, 최대 2개). 의미 있는 내용이 없으면 [].\n' +
    '- b: "개선 요청"에 해당하는 주제 목록(최대 2개). "없음", "좋습니다", "감사합니다" 같은 요청이 아닌 내용은 [].\n' +
    '- x: 두 글 중 하나라도 작성자나 특정 개인을 식별할 수 있으면 true (사람 이름·별명, 직책·부서·팀명, 작성자의 개인적 배경 설명 등). 아니면 false.\n\n' +
    '출력 형식: {"results":[{"i":번호,"h":[...],"b":[...],"x":false}]}\n\n' +
    '응답:\n' +
    JSON.stringify(chunk.map(r => ({ i: r.idx, help: r.help, improve: r.improve })));
  const parsed = parseJson_(claude_(system, user, 4000));
  return (parsed && parsed.results) || [];
}

function summarize_(rows) {
  const bySession = {};
  rows.forEach(r => {
    const s = bySession[r.session] = bySession[r.session] || { n: 0, q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 };
    s.n++; ['q1', 'q2', 'q3', 'q4', 'q5'].forEach(q => s[q] += r[q]);
  });
  const stats = Object.keys(bySession).map(k => {
    const s = bySession[k];
    const f = v => Math.round(v / s.n * 10) / 10;
    return { session: k, n: s.n, q1: f(s.q1), q2: f(s.q2), q3: f(s.q3), q4: f(s.q4), q5: f(s.q5) };
  });
  const comments = rows.filter(r => r.help || r.improve).map(r => ({
    p: anonId_(rows, r.email), session: r.session, q5: r.q5, help: r.help, improve: r.improve
  }));
  const low = rows.filter(r => r.q5 <= 3).map(r => ({ p: anonId_(rows, r.email), session: r.session, q5: r.q5 }));

  const system =
    '당신은 사내 인재개발팀 담당자를 돕는 분석가입니다. 한국어 존댓말로 작성하고 반드시 JSON만 출력합니다. ' +
    'Q1=커리큘럼 체계성, Q2=시간/일정 운영, Q3=실무 적용 기대, Q4=난이도 적절성, Q5=전반적 만족도 (5점 만점).';
  const user =
    '[회차별 평균]\n' + JSON.stringify(stats) + '\n\n' +
    '[Q5 3점 이하 응답]\n' + JSON.stringify(low) + '\n\n' +
    '[주관식 응답]\n' + JSON.stringify(comments) + '\n\n' +
    '아래 JSON으로만 답하세요.\n' +
    '{"overall":"전반적인 의견 2~4문장",' +
    '"nextSteps":["다음 교육에 반영하면 좋을 점 5~7개, 각 한 문장"],' +
    '"participants":["담당자 참고용 참석자별 반응 3~5개. 참석자는 P01 같은 익명 ID로만 지칭"]}\n' +
    '규칙: overall과 nextSteps는 외부에 공유되므로 특정 개인을 지칭하거나 유추하게 하는 표현(이름, 익명 ID, "한 명이 ~")을 쓰지 말고 "일부 참석자"처럼 집단으로 서술하세요. ' +
    '숫자는 위 통계에 있는 값만 쓰고, 없는 내용을 지어내지 마세요.';
  return parseJson_(claude_(system, user, 3000)) || {};
}

function claude_(system, user, maxTokens) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: MODEL, max_tokens: maxTokens, system: system,
      messages: [{ role: 'user', content: user }]
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Claude API ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
  const data = JSON.parse(res.getContentText());
  return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
}

// ------------------------------------------------------------------ 유틸
function parseJson_(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch (_) { return null; }
}

function cleanTopics_(list) {
  return (Array.isArray(list) ? list : []).filter(t => TOPICS.indexOf(t) >= 0).slice(0, 2);
}

function anonId_(rows, email) {
  const seen = [];
  rows.forEach(r => { if (seen.indexOf(r.email) < 0) seen.push(r.email); });
  const n = seen.indexOf(email) + 1;
  return 'P' + (n < 10 ? '0' + n : n);
}

function hash_(rows) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rows));
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function shuffle_(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 분석 결과 캐시 (스크립트 속성은 값당 9KB 제한이라 쪼개서 저장)
function saveAnalysis_(obj) {
  const props = PropertiesService.getScriptProperties();
  const s = JSON.stringify(obj), SIZE = 8000;
  const n = Math.ceil(s.length / SIZE);
  for (let i = 0; i < n; i++) props.setProperty('ANALYSIS_' + i, s.slice(i * SIZE, (i + 1) * SIZE));
  const old = Number(props.getProperty('ANALYSIS_N') || 0);
  for (let i = n; i < old; i++) props.deleteProperty('ANALYSIS_' + i);
  props.setProperty('ANALYSIS_N', String(n));
}

function loadAnalysis_() {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty('ANALYSIS_N') || 0);
  if (!n) return null;
  let s = '';
  for (let i = 0; i < n; i++) s += props.getProperty('ANALYSIS_' + i) || '';
  try { return JSON.parse(s); } catch (_) { return null; }
}

/** 진단용: 응답을 못 읽을 때 실행하면 탭별 인식 결과를 로그로 보여줍니다. */
function debugRows() {
  const ss = SpreadsheetApp.getActive();
  console.log('스프레드시트: ' + ss.getName());
  ss.getSheets().forEach(sh => {
    const values = sh.getLastRow() ? sh.getDataRange().getValues() : [];
    const map = values.length ? mapHeader_(values[0]) : null;
    console.log('탭 "' + sh.getName() + '" — ' + values.length + '행 — ' + (map ? '응답 탭으로 인식' : '제외(헤더가 응답 형식이 아님)'));
  });
  const rows = readRows_();
  console.log('합쳐서 읽은 응답 수: ' + rows.length);
  const n = {};
  rows.forEach(r => { n[r.session] = (n[r.session] || 0) + 1; });
  console.log('회차별: ' + JSON.stringify(n));
}

/** 수동 실행용: Apps Script 편집기에서 실행하면 즉시 재분석합니다(권한 승인 확인 겸용). */
function runAnalysisNow() {
  const a = analyze_(true);
  console.log(a ? ('분석 완료: ' + Object.keys(a.cls).length + '건') : '분석 실패 — 스크립트 속성과 로그를 확인하세요');
}
