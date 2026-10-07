// 교육 만족도 대시보드 — 교육 목록(랜딩) + 교육별 대시보드
// - 공개 화면: 개인을 식별할 수 있는 정보(이메일·이름·개인별 추이·순위)를 받지도, 표시하지도 않습니다.
// - 관리자 화면(#/<교육>/admin): 비밀번호(토큰)를 서버(Apps Script)가 확인해야만 이메일 포함 데이터를 받습니다.

window.addEventListener('error', function(e){
  try{
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#FFF2F0;border:1px solid #FFD9D4;color:#D64545;padding:14px 18px;margin:16px auto;max-width:1120px;border-radius:12px;font-size:13px;line-height:1.6;white-space:pre-wrap;';
    banner.textContent = '⚠️ 실행 중 오류가 발생했습니다: ' + (e.message || '알 수 없는 오류');
    document.body.prepend(banner);
  }catch(_){}
});

const QIDS = ["q1","q2","q3","q4","q5"];
const QLABELS = { q1:"교육 커리큘럼 체계성", q2:"시간/일정 운영", q3:"실무 적용 기대", q4:"난이도 적절성", q5:"전반적 만족도" };
const QCOLORS = { q1:"#8FB8DE", q2:"#7ED0C0", q3:"#F2C14E", q4:"#B692D6", q5:"#FF5A00" };

const COURSES = window.COURSES || [];
const appEl = document.getElementById('app');

// 교육별 공개 데이터 { rows, meta, insights } 또는 { error }
const publicData = {};

function avg(arr){ return arr.reduce((a,b)=>a+b,0)/arr.length; }
function round1(n){ return Math.round(n*10)/10; }
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------------------------------------------------------------- 데이터 로딩
function snapshotOf(course){
  const rows = (course.dataVar && window[course.dataVar]) || [];
  const pv = course.uniquePeopleVar && window[course.uniquePeopleVar];
  return { rows: rows, meta: { total: rows.length, uniquePeople: pv || null }, insights: null };
}

async function fetchPublic(course){
  if(!course.apiUrl) return snapshotOf(course);
  const res = await fetch(course.apiUrl, { cache: 'no-store' });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if(Array.isArray(data)) return fromLegacy(data);
  if(!data || !Array.isArray(data.rows)) throw new Error('데이터 형식이 올바르지 않습니다');
  return data;
}

// 이전 버전 서버(이름·이메일을 포함한 배열) 호환: 개인 필드는 즉시 버리고,
// 식별 검사를 거치지 않은 의견 원문은 공개 화면에서 숨깁니다. (서버를 새 버전으로 재배포하면 사라지는 임시 경로)
function fromLegacy(list){
  const people = new Set(list.map(r=>r.email || r.name));
  const rows = list.map(r=>({
    session: r.session, q1: r.q1, q2: r.q2, q3: r.q3, q4: r.q4, q5: r.q5, avg: r.avg,
    help: '', improve: '', ht: [], it: [],
    hid: !!(String(r.help||'').trim() || String(r.improve||'').trim())
  }));
  for(let i = rows.length - 1; i > 0; i--){ const j = Math.floor(Math.random()*(i+1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  return { rows, meta: { total: rows.length, uniquePeople: people.size, analyzedAt: null }, insights: null, legacy: true };
}

// 관리자: 토큰은 요청 본문(POST)으로만 보내고, 브라우저 탭 세션에만 보관합니다.
function adminToken(){ try{ return sessionStorage.getItem('adminToken') || ''; }catch(_){ return ''; } }
function setAdminToken(t){ try{ t ? sessionStorage.setItem('adminToken', t) : sessionStorage.removeItem('adminToken'); }catch(_){} }

async function fetchAdmin(course, action){
  const res = await fetch(course.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: adminToken(), action: action || 'view' })
  });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if(data.error === 'unauthorized') throw new Error('비밀번호가 올바르지 않습니다');
  if(data.error === 'locked') throw new Error('실패 횟수가 많아 잠시 잠겼습니다. 10분 뒤에 다시 시도해 주세요');
  if(data.error) throw new Error(data.error);
  return data;
}

// ---------------------------------------------------------------- 회차 문자열
function sessionKey(s){
  const m = String(s).match(/^(\d+)\/(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [99, 99];
}
function compareSessions(a, b){
  const [am, ad] = sessionKey(a), [bm, bd] = sessionKey(b);
  return (am-bm) || (ad-bd) || String(a).localeCompare(String(b), 'ko');
}
function groupOf(s){
  const m = String(s).match(/([A-Za-z가-힣])조/);
  return m ? m[1] : null;
}
function sortedSessions(rows){
  return Array.from(new Set(rows.map(r=>r.session))).sort(compareSessions);
}
function makeLabelers(sessions){
  return {
    full(s){
      if(/\d+회/.test(s)) return s;
      const idx = sessions.indexOf(s);
      return idx === -1 ? s : `${s}(${idx+1}회)`;
    },
    short(s){
      const m = String(s).match(/^(\d+\/\d+)\s*\(([^)]+)\)\s*([^\s]+조)\s*(\d+)회/);
      if(m) return [`${m[1]}(${m[2]})`, `${m[3]} ${m[4]}회`];
      const idx = sessions.indexOf(s);
      return idx === -1 ? s : `${s}(${idx+1}회)`;
    }
  };
}
function plainShort(l){ return Array.isArray(l) ? l.join(' ') : l; }

const EMPTY_RE = /^(없(음|습니다|어요|습이다|네요)?|아직 없(어요|습니다)?|특별히 없(음|습니다)?|특이사항 없습니다|현재는 없습니다|초반이라 아직 없습니다|딱히|x|na|\.|-)[\s.!~-]*$/i;
function isEmptyOpinion(t){
  if(!t) return true;
  const s = String(t).trim();
  return s === '' || EMPTY_RE.test(s);
}

// ---------------------------------------------------------------- 차트 공통
const barValueLabelPlugin = {
  id: 'barValueLabel',
  afterDatasetsDraw(chart){
    const {ctx} = chart;
    chart.data.datasets.forEach((dataset, i)=>{
      const meta = chart.getDatasetMeta(i);
      if(meta.hidden) return;
      const isBar = meta.type === 'bar';
      meta.data.forEach((el, idx)=>{
        const value = dataset.data[idx];
        if(value===undefined || value===null) return;
        ctx.save();
        ctx.font = '700 10px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'center';
        if(isBar){
          ctx.textBaseline = 'top';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.32)';
          ctx.strokeText(value, el.x, el.y + 4);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(value, el.x, el.y + 4);
        } else {
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = '#4A4A4A';
          ctx.fillText(value, el.x, el.y - 3);
        }
        ctx.restore();
      });
    });
  }
};
if(window.Chart) Chart.register(barValueLabelPlugin);

let chartInstances = { vol:null, q:null, person:null, qMini:[] };
function destroyAllCharts(){
  ['vol','q','person'].forEach(k=>{ if(chartInstances[k]){ chartInstances[k].destroy(); chartInstances[k]=null; } });
  chartInstances.qMini.forEach(c=>c.destroy());
  chartInstances.qMini = [];
}

// ==================================================================
// 1) 교육 목록(랜딩)
// ==================================================================
function courseCardHtml(c){
  const d = publicData[c.id];
  const isActive = c.status === 'active';
  const next = (c.upcoming || [])[0];
  let body;
  if(!d){
    body = `<div class="empty-note">불러오는 중…</div>`;
  } else if(d.error){
    body = `<div class="empty-note">데이터를 불러오지 못했습니다.</div>`;
  } else if(!d.rows.length){
    body = `<div class="empty-note">아직 응답이 없습니다.</div>`;
  } else {
    body = `
      <div class="course-meta">
        <div><div class="m-label">회차</div><div class="m-val">${sortedSessions(d.rows).length}<small>회</small></div></div>
        <div><div class="m-label">응답</div><div class="m-val">${d.rows.length}<small>건</small></div></div>
        <div><div class="m-label">만족도</div><div class="m-val orange">${round1(avg(d.rows.map(r=>r.q5)))}<small>/5</small></div></div>
      </div>`;
  }
  return `
    <button class="course-card" data-course="${escapeHtml(c.id)}">
      <span class="pill ${isActive?'active':'ended'}">${isActive?'● 진행 중':'종료'}</span>
      <h3>${escapeHtml(c.title)}</h3>
      <p class="tag">${escapeHtml(c.tagline || '')}</p>
      ${body}
      <div class="course-foot">
        <span>${next ? `다음 교육 <b>${escapeHtml(next)}</b>` : (isActive ? '진행 중' : '교육 종료')}</span>
        <span><b>만족도 보기 →</b></span>
      </div>
    </button>`;
}

function renderLanding(){
  destroyAllCharts();
  const active = COURSES.filter(c=>c.status==='active');
  const ended = COURSES.filter(c=>c.status!=='active');
  appEl.innerHTML = `
    <header>
      <span class="eyebrow">인재개발팀 · 교육 만족도</span>
      <h1>교육 만족도 대시보드</h1>
      <p class="desc">교육을 선택하면 회차별 만족도 조사 결과를 확인할 수 있습니다</p>
    </header>

    <div class="section-title"><span class="dot"></span>현재 진행 중인 교육</div>
    <div class="course-grid">
      ${active.length ? active.map(courseCardHtml).join('') : '<div class="empty-note">현재 진행 중인 교육이 없습니다.</div>'}
    </div>

    ${ended.length ? `
    <div class="section-title muted"><span class="dot"></span>지난 교육</div>
    <div class="course-grid">${ended.map(courseCardHtml).join('')}</div>` : ''}

    <footer>[인재개발팀] 교육 만족도 조사(응답) 원본 데이터 기반 · 개인 식별 정보는 공개 화면에 표시되지 않습니다</footer>
  `;
  appEl.querySelectorAll('.course-card').forEach(btn=>{
    btn.addEventListener('click', ()=>{ location.hash = '#/' + btn.dataset.course; });
  });
  document.title = '교육 만족도 대시보드';
  window.scrollTo(0,0);

  // 카드에 통계를 채우기 위해 아직 못 받은 교육 데이터를 불러옴
  const pending = COURSES.filter(c=>!publicData[c.id]);
  if(pending.length){
    Promise.all(pending.map(async c=>{
      try{ publicData[c.id] = await fetchPublic(c); }
      catch(err){ publicData[c.id] = { error: err.message }; }
    })).then(()=>{ if(currentRoute().id === '') renderLanding(); });
  }
}

// ==================================================================
// 2) 교육별 대시보드
// ==================================================================
function renderCourse(course, adminMode){
  destroyAllCharts();
  document.title = `${course.title} 만족도 대시보드`;
  const next = (course.upcoming || [])[0];
  const canRefresh = !!course.apiUrl;

  appEl.innerHTML = `
    <header>
      <button class="back-btn" id="backBtn">← 교육 목록</button>
      <div class="header-top">
        <div>
          <span class="eyebrow">${escapeHtml(course.eyebrow || course.title)}${adminMode ? ' · 관리자' : ''}</span>
          <h1>${escapeHtml(course.title)} 만족도 대시보드</h1>
          <p class="desc" id="headerDesc"></p>
          ${next ? `<span class="next-badge">다음 교육 · ${escapeHtml(next)}</span>` : ''}
        </div>
        ${canRefresh ? `
        <div class="update-box">
          <button id="updateBtn" class="analyze-btn">🔄 최신 데이터 가져오기</button>
          <p id="updateStatus" class="update-status">&nbsp;</p>
        </div>` : ''}
      </div>
    </header>
    ${adminMode ? `<div class="admin-banner">🔒 관리자 보기 — 이메일 등 개인 식별 정보가 포함되어 있습니다. 화면 공유·캡처에 주의하세요.
      <button class="chip" id="logoutBtn">로그아웃</button></div>` : ''}
    <div id="dash"><div class="card"><p class="cap" style="margin:0;">불러오는 중…</p></div></div>
    <footer>[인재개발팀] ${escapeHtml(course.title)} 만족도 조사(응답) 원본 데이터 기반${adminMode ? '' : ' · 개인 식별 정보는 공개 화면에 표시되지 않습니다'}</footer>
  `;
  document.getElementById('backBtn').addEventListener('click', ()=>{ location.hash = '#/'; });
  const lo = document.getElementById('logoutBtn');
  if(lo) lo.addEventListener('click', ()=>{ setAdminToken(''); location.hash = '#/' + course.id; });

  const state = { group: 'ALL', data: null, admin: adminMode, status: null };
  const dash = document.getElementById('dash');
  const statusEl = () => document.getElementById('updateStatus');

  async function load(action){
    const btn = document.getElementById('updateBtn');
    if(btn){ btn.disabled = true; btn.textContent = '가져오는 중...'; }
    try{
      const data = adminMode ? await fetchAdmin(course, action) : await fetchPublic(course);
      if(!adminMode) publicData[course.id] = data;
      state.data = data;
      drawDashboard(course, state);
      if(statusEl() && course.apiUrl){
        statusEl().textContent = `마지막 업데이트: ${new Date().toLocaleString('ko-KR')} · 총 ${data.rows.length}건`;
        statusEl().style.color = 'var(--good)';
      }
    }catch(err){
      if(adminMode){ setAdminToken(''); renderAdminLogin(course, err.message); return; }
      dash.innerHTML = `<div class="card" style="border-color:#FFD9D4;background:#FFF7F5;"><h2 style="color:var(--bad);">⚠️ 데이터를 불러오지 못했습니다</h2>
        <p class="cap" style="margin:0;">${escapeHtml(err.message)} — 잠시 후 다시 시도해 주세요.</p></div>`;
    }finally{
      const b = document.getElementById('updateBtn');
      if(b){ b.disabled = false; b.textContent = '🔄 최신 데이터 가져오기'; }
    }
  }
  state.reload = load;

  const updateBtn = document.getElementById('updateBtn');
  if(updateBtn) updateBtn.addEventListener('click', ()=>load());

  // 공개 보기는 이미 받아둔 데이터가 있으면 바로 사용
  if(!adminMode && publicData[course.id] && !publicData[course.id].error){
    state.data = publicData[course.id];
    drawDashboard(course, state);
  } else {
    load();
  }
  window.scrollTo(0,0);
}

function renderAdminLogin(course, errMsg){
  destroyAllCharts();
  document.title = `${course.title} 관리자`;
  appEl.innerHTML = `
    <header>
      <button class="back-btn" id="backBtn">← ${escapeHtml(course.title)} 공개 화면</button>
      <h1>관리자 로그인</h1>
      <p class="desc">${escapeHtml(course.title)} · 이메일 등 개인 식별 정보를 확인할 수 있는 화면입니다</p>
    </header>
    <div class="card" style="max-width:420px;">
      <form id="loginForm">
        <label class="cap" for="tokenInput" style="display:block;margin-bottom:8px;">관리자 비밀번호</label>
        <input id="tokenInput" type="password" autocomplete="off" class="text-input" required>
        <button class="analyze-btn" type="submit" style="margin-top:12px;">확인</button>
        ${errMsg ? `<p class="update-status" style="color:var(--bad);max-width:none;">${escapeHtml(errMsg)}</p>` : ''}
      </form>
    </div>`;
  document.getElementById('backBtn').addEventListener('click', ()=>{ location.hash = '#/' + course.id; });
  document.getElementById('loginForm').addEventListener('submit', ev=>{
    ev.preventDefault();
    setAdminToken(document.getElementById('tokenInput').value);
    renderCourse(course, true);
  });
}

// ---------------------------------------------------------------- 대시보드 본문
function drawDashboard(course, state){
  destroyAllCharts();
  const dash = document.getElementById('dash');
  const D = state.data;
  const ALL = D.rows || [];
  const admin = !!state.admin;

  if(ALL.length === 0){
    dash.innerHTML = `<div class="card"><h2>아직 응답이 없습니다</h2><p class="cap">응답이 쌓이면 이곳에 결과가 표시됩니다.</p></div>`;
    document.getElementById('headerDesc').textContent = '';
    return;
  }

  const groups = Array.from(new Set(ALL.map(r=>groupOf(r.session)).filter(Boolean))).sort();
  if(state.group !== 'ALL' && !groups.includes(state.group)) state.group = 'ALL';
  const RAW = state.group === 'ALL' ? ALL : ALL.filter(r=>groupOf(r.session)===state.group);

  const SESSIONS = sortedSessions(RAW);
  const L = makeLabelers(SESSIONS);

  document.getElementById('headerDesc').textContent =
    `${L.full(SESSIONS[0])} ~ ${L.full(SESSIONS[SESSIONS.length-1])} · 총 ${SESSIONS.length}회차 · 회차별 만족도 추이${admin ? '와 개인별 문항 점수 변화' : ''}`;

  const sessionAgg = SESSIONS.map(s=>{
    const rows = RAW.filter(r=>r.session===s);
    const out = {session:s, count:rows.length};
    QIDS.forEach(q=>{ out[q]=avg(rows.map(r=>r[q])); });
    out.avg = avg(rows.map(r=>r.avg));
    return out;
  });

  const totalResponses = RAW.length;
  // 참여 인원: 관리자는 이메일로, 공개는 서버가 계산한 전체 값을 사용(조 필터 시에는 표시하지 않음)
  let uniquePeopleTxt = '—', uniqueSub = '조 선택 시 집계하지 않음';
  if(admin){
    uniquePeopleTxt = `${new Set(RAW.map(r=>r.email)).size}<span>명</span>`; uniqueSub = '중복 제거 기준';
  } else if(state.group === 'ALL' && D.meta && D.meta.uniquePeople){
    uniquePeopleTxt = `${D.meta.uniquePeople}<span>명</span>`; uniqueSub = '중복 제거 기준';
  }
  const overallAvg = avg(RAW.map(r=>r.q5));
  const bestSession = sessionAgg.reduce((a,b)=>b.q5>a.q5?b:a, sessionAgg[0]);
  const worstSession = sessionAgg.reduce((a,b)=>b.q5<a.q5?b:a, sessionAgg[0]);

  const hasTopics = ALL.some(r=>(r.ht&&r.ht.length)||(r.it&&r.it.length));

  dash.innerHTML = `
    <div class="card ai-summary" id="summaryCard"></div>

    ${groups.length > 1 ? `
    <div class="filter-row" id="groupFilter">
      <button class="chip ${state.group==='ALL'?'on':''}" data-g="ALL">전체</button>
      ${groups.map(g=>`<button class="chip ${state.group===g?'on':''}" data-g="${escapeHtml(g)}">${escapeHtml(g)}조</button>`).join('')}
    </div>` : ''}

    <div class="kpi-row">
      <div class="kpi"><div class="label">총 응답 수</div><div class="value">${totalResponses}<span>건</span></div><div class="sub">${SESSIONS.length}개 회차 누적</div></div>
      <div class="kpi"><div class="label">참여 인원</div><div class="value">${uniquePeopleTxt}</div><div class="sub">${uniqueSub}</div></div>
      <div class="kpi"><div class="label">전체 평균 만족도</div><div class="value orange">${round1(overallAvg)}<span>/ 5.0</span></div><div class="sub">전반적인 교육 만족도 문항 기준</div></div>
      <div class="kpi"><div class="label">최고 · 최저 회차</div><div class="value" style="font-size:15px;line-height:1.5;">${escapeHtml(plainShort(L.short(bestSession.session)))} <span style="color:var(--good);">${round1(bestSession.q5)}</span><br>${escapeHtml(plainShort(L.short(worstSession.session)))} <span style="color:var(--bad);">${round1(worstSession.q5)}</span></div><div class="sub">Q5 전반적 만족도 기준</div></div>
    </div>

    <div class="card">
      <h2>문항별 회차 점수 추이</h2>
      <p class="cap">문항별로 나눠서 회차별 변화를 비교합니다 (막대 위 숫자: 해당 회차 평균 점수)</p>
      <div class="qgrid" id="qGrid"></div>
    </div>

    <div class="two-col">
      <div class="card">
        <h2>회차별 참여 인원 &amp; 종합 만족도</h2>
        <p class="cap">막대: 응답자 수 · 선: 전반적 만족도(Q5) 평균</p>
        <div class="chart-box" style="height:260px;"><canvas id="volChart"></canvas></div>
      </div>
      <div class="card">
        <h2>문항별 전체 평균 비교</h2>
        <p class="cap">전 회차 통합 문항별 평균 점수</p>
        <div class="chart-box" style="height:260px;"><canvas id="qChart"></canvas></div>
      </div>
    </div>

    ${admin ? `
    <div class="card">
      <div class="person-header">
        <div>
          <h2 style="margin-bottom:2px;">개인별 만족도 변화</h2>
          <p class="cap" style="margin:0;">참석자를 선택하면 전반적 만족도(Q5) 기준 회차별 변화를 확인할 수 있습니다</p>
        </div>
        <select id="personSelect"></select>
      </div>
      <div id="personStatsRow" class="person-stats" style="margin-bottom:10px;"></div>
      <div class="chart-box"><canvas id="personChart"></canvas></div>
    </div>

    <div class="card">
      <h2>참석자별 만족도 상위 · 하위 5명</h2>
      <p class="cap">평균 만족도(Q5) 기준 · 참여 횟수, 첫회차→마지막회차 변화 추이 포함</p>
      <div class="rank-grid">
        <div class="rank-col top">
          <h3>🏆 상위 5명</h3>
          <table id="topTable"><thead><tr><th style="text-align:left;">이름</th><th>참여</th><th>평균 만족도(Q5)</th><th>평균 종합</th><th>추이</th></tr></thead><tbody></tbody></table>
        </div>
        <div class="rank-col bottom">
          <h3>⚠️ 하위 5명</h3>
          <table id="bottomTable"><thead><tr><th style="text-align:left;">이름</th><th>참여</th><th>평균 만족도(Q5)</th><th>평균 종합</th><th>추이</th></tr></thead><tbody></tbody></table>
        </div>
      </div>
    </div>` : ''}

    ${hasTopics ? `
    <div class="card">
      <h2>의견 주제 분석</h2>
      <p class="cap">Claude가 주관식 응답을 주제별로 분류한 결과입니다 · 주제를 누르면 아래 의견 목록이 필터됩니다</p>
      <div class="insight-grid">
        <div class="insight-col good"><h3>👍 좋았던 점</h3><div class="topic-list" id="goodTopics"></div></div>
        <div class="insight-col bad"><h3>🔧 개선 요청</h3><div class="topic-list" id="badTopics"></div></div>
      </div>
    </div>` : ''}

    <div class="card">
      <div class="person-header">
        <div>
          <h2 style="margin-bottom:2px;">회차별 주요 의견</h2>
          <p class="cap" style="margin:0;">주관식 응답(도움된 부분 · 개선 요청)을 회차${hasTopics ? '·주제' : ''}별로 확인할 수 있습니다</p>
        </div>
        <div class="select-row">
          <select id="opinionSelect"></select>
          ${hasTopics ? '<select id="topicSelect"></select>' : ''}
        </div>
      </div>
      <div class="insight-grid" style="margin-top:14px;">
        <div class="insight-col good">
          <h3>👍 좋았던 점 <span class="opinion-count" id="goodCount"></span></h3>
          <ul class="insight-list scroll-list" id="goodList"></ul>
        </div>
        <div class="insight-col bad">
          <h3>🔧 개선이 필요한 점 <span class="opinion-count" id="badCount"></span></h3>
          <ul class="insight-list scroll-list" id="badList"></ul>
        </div>
      </div>
      <p class="ai-note" id="hiddenNote" style="display:none;"></p>
    </div>

  `;

  const gf = document.getElementById('groupFilter');
  if(gf) gf.querySelectorAll('.chip').forEach(b=>{
    b.addEventListener('click', ()=>{ state.group = b.dataset.g; drawDashboard(course, state); });
  });

  // ---- 문항별 미니 차트 ----
  const qGrid = document.getElementById('qGrid');
  QIDS.forEach((q, idx)=>{
    const card = document.createElement('div');
    card.className = 'qcard';
    card.innerHTML = `<h3>${idx+1}) ${QLABELS[q]}</h3><div class="qchart-box"><canvas></canvas></div>`;
    qGrid.appendChild(card);
    chartInstances.qMini.push(new Chart(card.querySelector('canvas'), {
      type:'bar',
      data:{ labels: SESSIONS.map(L.short),
        datasets:[{ data: sessionAgg.map(s=>round1(s[q])), backgroundColor: QCOLORS[q], borderRadius:5, barPercentage:0.7, categoryPercentage:0.75 }] },
      options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ top: 4 } },
        scales:{ y:{ min:1, max:5, ticks:{ stepSize:2, font:{size:9} } }, x:{ ticks:{ font:{size:9} } } },
        plugins:{ legend:{ display:false } } }
    }));
  });

  chartInstances.vol = new Chart(document.getElementById('volChart'), {
    data:{ labels: SESSIONS.map(L.short),
      datasets:[
        { type:'bar', label:'응답자 수', data: sessionAgg.map(s=>s.count), backgroundColor:'#FFB37A', borderRadius:6, yAxisID:'y1', order:2 },
        { type:'line', label:'전반적 만족도(Q5)', data: sessionAgg.map(s=>round1(s.q5)), borderColor:'#FF5A00', backgroundColor:'#FF5A00', borderWidth:3, pointRadius:4, tension:.3, yAxisID:'y2', order:1 }
      ] },
    options:{ responsive:true, maintainAspectRatio:false,
      scales:{
        y1:{ position:'left', beginAtZero:true, title:{display:true,text:'인원'} },
        y2:{ position:'right', min:1, max:5, grid:{drawOnChartArea:false}, title:{display:true,text:'만족도'} },
        x:{ ticks:{ font:{size:10} } } },
      plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, font:{size:11} } } } }
  });

  chartInstances.q = new Chart(document.getElementById('qChart'), {
    type:'bar',
    data:{ labels:["Q1\n커리큘럼","Q2\n시간/일정","Q3\n실무적용","Q4\n난이도","Q5\n전반만족"],
      datasets:[{ data: QIDS.map(q=>round1(avg(RAW.map(r=>r[q])))), backgroundColor:QIDS.map(q=>QCOLORS[q]), borderRadius:8 }] },
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ min:1, max:5, ticks:{stepSize:1} } }, plugins:{ legend:{display:false} } }
  });

  if(admin) drawPeopleSections(RAW, SESSIONS, L);

  // ---- 주제 분석 & 의견 ----
  const topicFilter = { value: '__ALL__' };
  const topicCount = (key)=>{
    const m = {};
    RAW.forEach(r=>(r[key]||[]).forEach(t=>{ m[t] = (m[t]||0) + 1; }));
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  };
  let renderOpinions = ()=>{};

  if(hasTopics){
    const topicSelect = document.getElementById('topicSelect');
    const allTopics = Array.from(new Set([...topicCount('ht'), ...topicCount('it')].map(x=>x[0])));
    topicSelect.innerHTML = '<option value="__ALL__">전체 주제</option>' + allTopics.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    const fillTopics = (id, list, cls)=>{
      const el = document.getElementById(id);
      const max = list.length ? list[0][1] : 1;
      el.innerHTML = list.length ? list.map(([t,n])=>`
        <button class="topic-row ${cls}" data-topic="${escapeHtml(t)}">
          <span class="topic-name">${escapeHtml(t)}</span>
          <span class="topic-bar"><i style="width:${Math.max(6, n/max*100)}%"></i></span>
          <span class="topic-n">${n}</span>
        </button>`).join('') : '<div class="empty-note">분류된 의견이 없습니다.</div>';
      el.querySelectorAll('.topic-row').forEach(b=>b.addEventListener('click', ()=>{
        topicSelect.value = b.dataset.topic; topicFilter.value = b.dataset.topic; renderOpinions();
        document.getElementById('goodList').scrollIntoView({behavior:'smooth', block:'center'});
      }));
    };
    fillTopics('goodTopics', topicCount('ht'), 'good');
    fillTopics('badTopics', topicCount('it'), 'bad');
    topicSelect.onchange = e=>{ topicFilter.value = e.target.value; renderOpinions(); };
  }

  const opinionSelect = document.getElementById('opinionSelect');
  opinionSelect.innerHTML = '<option value="__ALL__">전체 회차</option>' +
    SESSIONS.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(L.full(s))}</option>`).join('');

  renderOpinions = function(){
    const sFilter = opinionSelect.value;
    const tFilter = topicFilter.value;
    const rows = sFilter === '__ALL__' ? RAW : RAW.filter(r=>r.session===sFilter);
    const match = (r, key)=> tFilter === '__ALL__' || (r[key]||[]).includes(tFilter);
    const goods = rows.filter(r=>!isEmptyOpinion(r.help) && match(r,'ht'));
    const bads = rows.filter(r=>!isEmptyOpinion(r.improve) && match(r,'it'));
    document.getElementById('goodCount').textContent = `(${goods.length}건)`;
    document.getElementById('badCount').textContent = `(${bads.length}건)`;
    const fill = (id, list, key)=>{
      const ul = document.getElementById(id);
      ul.innerHTML = list.length ? '' : '<li class="opinion-empty">해당 조건의 의견이 없습니다.</li>';
      list.forEach(r=>{
        const li = document.createElement('li');
        const who = admin ? `<span class="who" title="${escapeHtml(r.email||'')}">${escapeHtml(r.name)}</span> ` : '';
        li.innerHTML = `${who}<span class="sess">(${escapeHtml(L.full(r.session))})</span> — ${escapeHtml(r[key])}`;
        ul.appendChild(li);
      });
    };
    fill('goodList', goods, 'help');
    fill('badList', bads, 'improve');
    const hidden = admin ? 0 : rows.filter(r=>r.hid).length;
    const note = document.getElementById('hiddenNote');
    note.style.display = hidden ? 'block' : 'none';
    note.textContent = hidden ? `개인 식별 가능성이 있거나 응답 수가 적은 회차의 의견 ${hidden}건은 개인정보 보호를 위해 표시하지 않았습니다.` : '';
  };
  opinionSelect.onchange = renderOpinions;
  renderOpinions();

  drawSummary(course, state, D);
}

// ---------------------------------------------------------------- 관리자 전용: 개인별/순위
function drawPeopleSections(RAW, SESSIONS, L){
  const people = {};
  RAW.forEach(r=>{ (people[r.email] = people[r.email] || []).push(r); });
  Object.values(people).forEach(arr=>arr.sort((a,b)=>SESSIONS.indexOf(a.session)-SESSIONS.indexOf(b.session)));
  const keys = Object.keys(people).sort((a,b)=>people[b].length-people[a].length || a.localeCompare(b,'ko'));

  const sel = document.getElementById('personSelect');
  keys.forEach(k=>{
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = `${k} (${people[k].length}회 참여)`;
    sel.appendChild(opt);
  });

  function renderPerson(key){
    const rows = people[key];
    const pAvg = round1(avg(rows.map(r=>r.avg)));
    const q5first = rows[0].q5, q5last = rows[rows.length-1].q5;
    const diff = q5last - q5first;
    const trendTxt = rows.length<2 ? "—" : (diff>0?`+${diff} ▲`:diff<0?`${diff} ▼`:"0 →");
    const trendColor = rows.length<2 ? 'var(--sub)' : (diff>0?'var(--good)':diff<0?'var(--bad)':'var(--sub)');
    document.getElementById('personStatsRow').innerHTML = `
      <div class="pstat">참여 횟수<b>${rows.length}회</b></div>
      <div class="pstat">참여 회차<b>${rows.map(r=>escapeHtml(L.full(r.session))).join(', ')}</b></div>
      <div class="pstat">평균 종합점수<b>${pAvg} / 5.0</b></div>
      <div class="pstat">Q5 첫회차→최근<b style="color:${trendColor};">${q5first} → ${q5last} (${trendTxt})</b></div>`;
    if(chartInstances.person) chartInstances.person.destroy();
    chartInstances.person = new Chart(document.getElementById('personChart'), {
      type:'bar',
      data:{ labels: rows.map(r=>L.short(r.session)),
        datasets:[{ label:'전반적 만족도(Q5)', data: rows.map(r=>r.q5), backgroundColor:'#FF5A00', borderRadius:6, barPercentage:0.5, categoryPercentage:0.6 }] },
      options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ top: 14 } },
        scales:{ y:{ min:1, max:5, ticks:{stepSize:1} } }, plugins:{ legend:{ display:false } } }
    });
  }
  sel.onchange = e=>renderPerson(e.target.value);
  renderPerson(keys[0]);

  const trendHtmlFor = diff=>{
    if(diff===null) return '<span class="trend-flat">—</span>';
    if(diff>0) return `<span class="trend-up">▲ +${diff}</span>`;
    if(diff<0) return `<span class="trend-down">▼ ${diff}</span>`;
    return '<span class="trend-flat">→ 0</span>';
  };
  const summaries = keys.map(k=>{
    const rows = people[k];
    return { name: rows[0].name, email: k, count: rows.length,
      q5avg: round1(avg(rows.map(r=>r.q5))), totalAvg: round1(avg(rows.map(r=>r.avg))),
      diff: rows.length>1 ? rows[rows.length-1].q5 - rows[0].q5 : null };
  });
  const renderRank = (selector, list)=>{
    const tbody = document.querySelector(selector);
    tbody.innerHTML = '';
    list.forEach(p=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="name" title="${escapeHtml(p.email)}">${escapeHtml(p.name)}</td><td>${p.count}회</td><td>${p.q5avg}</td><td>${p.totalAvg}</td><td>${trendHtmlFor(p.diff)}</td>`;
      tbody.appendChild(tr);
    });
  };
  const sorted = [...summaries].sort((a,b)=> b.q5avg - a.q5avg || b.totalAvg - a.totalAvg || b.count - a.count);
  renderRank('#topTable tbody', sorted.slice(0, 5));
  renderRank('#bottomTable tbody', sorted.slice(-5).reverse());
}

// ---------------------------------------------------------------- 요약 카드
function drawSummary(course, state, D){
  const card = document.getElementById('summaryCard');
  const ins = D.insights;
  const admin = state.admin;
  const when = D.meta && D.meta.analyzedAt ? new Date(D.meta.analyzedAt).toLocaleString('ko-KR') : '';

  if(ins){
    card.innerHTML = `
      <div class="ai-summary-header">
        <span class="ai-tag">✨ AI 요약</span>
        ${admin && course.apiUrl ? '<button id="regenBtn" class="analyze-btn">🔄 지금 데이터로 다시 분석</button>' : ''}
      </div>
      <div class="ai-block"><h3>설문조사 전반적인 의견</h3><p>${escapeHtml(ins.overall)}</p></div>
      <div class="ai-block"><h3>다음 교육에 반영하면 좋을 점</h3><ul>${(ins.nextSteps||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul></div>
      ${admin && ins.participants && ins.participants.length ? `
      <div class="ai-block"><h3>참석자별 반응 (담당자 참고용 · 비공개)</h3><ul>${ins.participants.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul></div>` : ''}
      <p class="ai-note">Claude가 응답 데이터를 분석해 작성한 요약으로 참고용입니다${when ? ` · 분석 시각 ${escapeHtml(when)}` : ''}. 새 응답이 쌓이면 자동으로 다시 분석됩니다.</p>`;
    const rb = document.getElementById('regenBtn');
    if(rb) rb.addEventListener('click', ()=>{ rb.textContent = '분석 중… (최대 1분)'; rb.disabled = true; state.reload('regenerate'); });
  } else if(course.summary){
    card.innerHTML = `
      <div class="ai-summary-header"><span class="ai-tag">✨ 요약</span></div>
      <div>${course.summary}</div>
      <p class="ai-note">이 요약은 ${escapeHtml(course.summaryDate || '')} 기준 데이터로 작성된 스냅샷입니다.</p>`;
  } else {
    card.innerHTML = `
      <div class="ai-summary-header"><span class="ai-tag">✨ AI 요약</span></div>
      <p class="cap" style="margin:0;">AI 요약을 준비 중입니다. 잠시 후 다시 확인해 주세요.</p>`;
  }
}

// ==================================================================
// 라우팅: #/ → 목록, #/<id> → 공개 대시보드, #/<id>/admin → 관리자
// ==================================================================
function currentRoute(){
  const parts = decodeURIComponent((location.hash || '').replace(/^#\/?/, '')).split('/');
  return { id: parts[0] || '', admin: parts[1] === 'admin' };
}
function route(){
  const r = currentRoute();
  const course = COURSES.find(c=>c.id === r.id);
  if(!course) return renderLanding();
  if(r.admin){
    if(!course.apiUrl) return renderCourse(course, false);   // 실시간 연동이 없는 교육은 관리자 화면 없음
    return adminToken() ? renderCourse(course, true) : renderAdminLogin(course);
  }
  renderCourse(course, false);
}
window.addEventListener('hashchange', route);
route();
