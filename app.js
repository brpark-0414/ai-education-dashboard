// 교육 만족도 대시보드 — 교육 목록(랜딩) + 교육별 대시보드
// 교육 목록은 data/courses.js, 응답 데이터는 data/*.js (또는 Apps Script 라이브 연동)에서 옵니다.

// ---- 화면에서 바로 에러를 볼 수 있는 배너 ----
window.addEventListener('error', function(e){
  try{
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#FFF2F0;border:1px solid #FFD9D4;color:#D64545;padding:14px 18px;margin:16px auto;max-width:1120px;border-radius:12px;font-size:13px;line-height:1.6;white-space:pre-wrap;';
    banner.textContent = '⚠️ 실행 중 오류가 발생했습니다: ' + (e.message || '알 수 없는 오류');
    document.body.prepend(banner);
  }catch(_){}
});

const QIDS = ["q1","q2","q3","q4","q5"];
const QLABELS = {
  q1:"교육 커리큘럼 체계성",
  q2:"시간/일정 운영",
  q3:"실무 적용 기대",
  q4:"난이도 적절성",
  q5:"전반적 만족도"
};
const QCOLORS = { q1:"#8FB8DE", q2:"#7ED0C0", q3:"#F2C14E", q4:"#B692D6", q5:"#FF5A00" };

const COURSES = window.COURSES || [];
const appEl = document.getElementById('app');

// 교육별 현재 데이터(스냅샷 → 라이브 갱신 시 교체)
const courseData = {};
COURSES.forEach(c => { courseData[c.id] = (window[c.dataVar] || []).slice(); });

function avg(arr){ return arr.reduce((a,b)=>a+b,0)/arr.length; }
function round1(n){ return Math.round(n*10)/10; }
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---- 회차 문자열 처리 ("7/21", "9/8 (화) A조 1회" 모두 지원) ----
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
// 화면 표기: 이미 "n회"가 들어 있으면 그대로, 아니면 "(n회)"를 붙임
function makeLabelers(sessions){
  return {
    full(s){
      if(/\d+회/.test(s)) return s;
      const idx = sessions.indexOf(s);
      return idx === -1 ? s : `${s}(${idx+1}회)`;
    },
    // 차트 축용 짧은 표기(배열이면 줄바꿈)
    short(s){
      const m = String(s).match(/^(\d+\/\d+)\s*\(([^)]+)\)\s*([^\s]+조)\s*(\d+)회/);
      if(m) return [`${m[1]}(${m[2]})`, `${m[3]} ${m[4]}회`];
      const idx = sessions.indexOf(s);
      return idx === -1 ? s : `${s}(${idx+1}회)`;
    }
  };
}
function plainShort(l){ return Array.isArray(l) ? l.join(' ') : l; }

const EMPTY_RE = /^(없(음|습니다|어요|습이다|네요)?|아직 없(어요|습니다)?|특별히 없(음|습니다)?|현재는 없습니다|초반이라 아직 없습니다|딱히|x|na|\.|-)[\s.!~-]*$/i;
function isEmptyOpinion(t){
  if(!t) return true;
  const s = String(t).trim();
  return s === '' || EMPTY_RE.test(s);
}

// ---- 막대/선 위 값 레이블 플러그인 ----
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
function courseStats(c){
  const rows = courseData[c.id] || [];
  if(!rows.length) return null;
  const sessions = sortedSessions(rows);
  return {
    count: rows.length,
    people: new Set(rows.map(r=>r.name)).size,
    q5: round1(avg(rows.map(r=>r.q5))),
    sessions
  };
}

function courseCardHtml(c){
  const st = courseStats(c);
  const isActive = c.status === 'active';
  const next = (c.upcoming || [])[0];
  return `
    <button class="course-card" data-course="${escapeHtml(c.id)}">
      <span class="pill ${isActive?'active':'ended'}">${isActive?'● 진행 중':'종료'}</span>
      <h3>${escapeHtml(c.title)}</h3>
      <p class="tag">${escapeHtml(c.tagline || '')}</p>
      ${st ? `
      <div class="course-meta">
        <div><div class="m-label">회차</div><div class="m-val">${st.sessions.length}<small>회</small></div></div>
        <div><div class="m-label">응답</div><div class="m-val">${st.count}<small>건</small></div></div>
        <div><div class="m-label">만족도</div><div class="m-val orange">${st.q5}<small>/5</small></div></div>
      </div>` : `<div class="empty-note">아직 응답이 없습니다.</div>`}
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

    <footer>[인재개발팀] 교육 만족도 조사(응답) 원본 데이터 기반 · 자동 생성 대시보드</footer>
  `;
  appEl.querySelectorAll('.course-card').forEach(btn=>{
    btn.addEventListener('click', ()=>{ location.hash = '#/' + btn.dataset.course; });
  });
  document.title = '교육 만족도 대시보드';
  window.scrollTo(0,0);
}

// ==================================================================
// 2) 교육별 대시보드
// ==================================================================
function renderCourse(course){
  destroyAllCharts();
  document.title = `${course.title} 만족도 대시보드`;
  const next = (course.upcoming || [])[0];

  appEl.innerHTML = `
    <header>
      <button class="back-btn" id="backBtn">← 교육 목록</button>
      <div class="header-top">
        <div>
          <span class="eyebrow">${escapeHtml(course.eyebrow || course.title)}</span>
          <h1>${escapeHtml(course.title)} 만족도 대시보드</h1>
          <p class="desc" id="headerDesc"></p>
          ${next ? `<span class="next-badge">다음 교육 · ${escapeHtml(next)}</span>` : ''}
        </div>
        ${course.apiUrl ? `
        <div class="update-box">
          <button id="updateBtn" class="analyze-btn">🔄 최신 데이터 가져오기</button>
          <p id="updateStatus" class="update-status">현재 화면은 마지막으로 만들어진 스냅샷입니다.</p>
        </div>` : ''}
      </div>
    </header>
    <div id="dash"></div>
    <footer>[인재개발팀] ${escapeHtml(course.title)} 만족도 조사(응답) 원본 데이터 기반 · 자동 생성 대시보드</footer>
  `;
  document.getElementById('backBtn').addEventListener('click', ()=>{ location.hash = '#/'; });

  const state = { group: 'ALL' };
  drawDashboard(course, state);

  const updateBtn = document.getElementById('updateBtn');
  if(updateBtn){
    const updateStatus = document.getElementById('updateStatus');
    updateBtn.addEventListener('click', async ()=>{
      updateBtn.disabled = true;
      const originalLabel = updateBtn.textContent;
      updateBtn.textContent = '가져오는 중...';
      try{
        const res = await fetch(course.apiUrl, { cache: 'no-store' });
        if(!res.ok) throw new Error('HTTP ' + res.status);
        const newData = await res.json();
        if(!Array.isArray(newData) || newData.length === 0) throw new Error('가져온 데이터가 비어있습니다');
        courseData[course.id] = newData;
        course.live = true;
        drawDashboard(course, state);
        updateStatus.textContent = `마지막 업데이트: ${new Date().toLocaleString('ko-KR')} · 총 ${newData.length}건`;
        updateStatus.style.color = 'var(--good)';
      }catch(err){
        updateStatus.textContent = `업데이트 실패: ${err.message} (Apps Script 배포 URL/권한을 확인해주세요)`;
        updateStatus.style.color = 'var(--bad)';
      }finally{
        updateBtn.disabled = false;
        updateBtn.textContent = originalLabel;
      }
    });
  }
  window.scrollTo(0,0);
}

function drawDashboard(course, state){
  destroyAllCharts();
  const dash = document.getElementById('dash');
  const ALL = courseData[course.id] || [];

  if(ALL.length === 0){
    dash.innerHTML = `<div class="card"><h2>아직 응답이 없습니다</h2>
      <p class="cap">응답이 쌓이면 이곳에 결과가 표시됩니다.</p></div>`;
    document.getElementById('headerDesc').textContent = '';
    return;
  }

  // 조(A/B) 필터: 회차명에 "A조/B조"가 있는 교육에서만 표시
  const groups = Array.from(new Set(ALL.map(r=>groupOf(r.session)).filter(Boolean))).sort();
  if(state.group !== 'ALL' && !groups.includes(state.group)) state.group = 'ALL';
  const RAW = state.group === 'ALL' ? ALL : ALL.filter(r=>groupOf(r.session)===state.group);

  const SESSIONS = sortedSessions(RAW);
  const L = makeLabelers(SESSIONS);

  document.getElementById('headerDesc').textContent =
    `${L.full(SESSIONS[0])} ~ ${L.full(SESSIONS[SESSIONS.length-1])} · 총 ${SESSIONS.length}회차 · 회차별 만족도 추이와 개인별 문항 점수 변화`;

  const sessionAgg = SESSIONS.map(s=>{
    const rows = RAW.filter(r=>r.session===s);
    const out = {session:s, count:rows.length};
    QIDS.forEach(q=>{ out[q]=avg(rows.map(r=>r[q])); });
    out.avg = avg(rows.map(r=>r.avg));
    return out;
  });

  const totalResponses = RAW.length;
  const uniquePeople = new Set(RAW.map(r=>r.name)).size;
  const overallAvg = avg(RAW.map(r=>r.q5));
  const bestSession = sessionAgg.reduce((a,b)=>b.q5>a.q5?b:a, sessionAgg[0]);
  const worstSession = sessionAgg.reduce((a,b)=>b.q5<a.q5?b:a, sessionAgg[0]);

  dash.innerHTML = `
    ${groups.length > 1 ? `
    <div class="filter-row" id="groupFilter">
      <button class="chip ${state.group==='ALL'?'on':''}" data-g="ALL">전체</button>
      ${groups.map(g=>`<button class="chip ${state.group===g?'on':''}" data-g="${escapeHtml(g)}">${escapeHtml(g)}조</button>`).join('')}
    </div>` : ''}

    <div class="kpi-row">
      <div class="kpi"><div class="label">총 응답 수</div><div class="value">${totalResponses}<span>건</span></div><div class="sub">${SESSIONS.length}개 회차 누적</div></div>
      <div class="kpi"><div class="label">참여 인원</div><div class="value">${uniquePeople}<span>명</span></div><div class="sub">중복 제거 기준</div></div>
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
    </div>

    <div class="card">
      <div class="person-header">
        <div>
          <h2 style="margin-bottom:2px;">회차별 주요 의견</h2>
          <p class="cap" style="margin:0;">주관식 응답(도움된 부분 · 개선 요청) 원문을 회차별로 확인할 수 있습니다</p>
        </div>
        <select id="opinionSelect"></select>
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
    </div>

    ${course.summary ? `
    <div class="card ai-summary">
      <div class="ai-summary-header"><span class="ai-tag">✨ 요약</span></div>
      <div>${course.summary}</div>
      <p class="ai-note">이 요약은 ${escapeHtml(course.summaryDate || '')} 기준 데이터로 작성된 스냅샷입니다. 이후 응답은 위 차트와 의견 목록에 반영됩니다.</p>
    </div>` : ''}
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
      data:{
        labels: SESSIONS.map(L.short),
        datasets:[{ data: sessionAgg.map(s=>round1(s[q])), backgroundColor: QCOLORS[q], borderRadius:5, barPercentage:0.7, categoryPercentage:0.75 }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        layout:{ padding:{ top: 4 } },
        scales:{ y:{ min:1, max:5, ticks:{ stepSize:2, font:{size:9} } }, x:{ ticks:{ font:{size:9} } } },
        plugins:{ legend:{ display:false } }
      }
    }));
  });

  // ---- 참여 인원 + Q5 ----
  chartInstances.vol = new Chart(document.getElementById('volChart'), {
    data:{
      labels: SESSIONS.map(L.short),
      datasets:[
        { type:'bar', label:'응답자 수', data: sessionAgg.map(s=>s.count), backgroundColor:'#FFB37A', borderRadius:6, yAxisID:'y1', order:2 },
        { type:'line', label:'전반적 만족도(Q5)', data: sessionAgg.map(s=>round1(s.q5)), borderColor:'#FF5A00', backgroundColor:'#FF5A00', borderWidth:3, pointRadius:4, tension:.3, yAxisID:'y2', order:1 }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{
        y1:{ position:'left', beginAtZero:true, title:{display:true,text:'인원'} },
        y2:{ position:'right', min:1, max:5, grid:{drawOnChartArea:false}, title:{display:true,text:'만족도'} },
        x:{ ticks:{ font:{size:10} } }
      },
      plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, font:{size:11} } } }
    }
  });

  // ---- 문항별 전체 평균 ----
  chartInstances.q = new Chart(document.getElementById('qChart'), {
    type:'bar',
    data:{
      labels:["Q1\n커리큘럼","Q2\n시간/일정","Q3\n실무적용","Q4\n난이도","Q5\n전반만족"],
      datasets:[{ data: QIDS.map(q=>round1(avg(RAW.map(r=>r[q])))), backgroundColor:QIDS.map(q=>QCOLORS[q]), borderRadius:8 }]
    },
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ min:1, max:5, ticks:{stepSize:1} } }, plugins:{ legend:{display:false} } }
  });

  // ---- 개인별 ----
  const people = {};
  RAW.forEach(r=>{ (people[r.name] = people[r.name] || []).push(r); });
  Object.values(people).forEach(arr=>arr.sort((a,b)=>SESSIONS.indexOf(a.session)-SESSIONS.indexOf(b.session)));
  const personNames = Object.keys(people).sort((a,b)=>people[b].length-people[a].length || a.localeCompare(b,'ko'));

  const sel = document.getElementById('personSelect');
  personNames.forEach(n=>{
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = `${n} (${people[n].length}회 참여)`;
    sel.appendChild(opt);
  });

  function renderPerson(name){
    const rows = people[name];
    const pAvg = round1(avg(rows.map(r=>r.avg)));
    const q5first = rows[0].q5, q5last = rows[rows.length-1].q5;
    const diff = q5last - q5first;
    const trendTxt = rows.length<2 ? "—" : (diff>0?`+${diff} ▲`:diff<0?`${diff} ▼`:"0 →");
    const trendColor = rows.length<2 ? 'var(--sub)' : (diff>0?'var(--good)':diff<0?'var(--bad)':'var(--sub)');
    document.getElementById('personStatsRow').innerHTML = `
      <div class="pstat">참여 횟수<b>${rows.length}회</b></div>
      <div class="pstat">참여 회차<b>${rows.map(r=>escapeHtml(L.full(r.session))).join(', ')}</b></div>
      <div class="pstat">평균 종합점수<b>${pAvg} / 5.0</b></div>
      <div class="pstat">Q5 첫회차→최근<b style="color:${trendColor};">${q5first} → ${q5last} (${trendTxt})</b></div>
    `;
    if(chartInstances.person) chartInstances.person.destroy();
    chartInstances.person = new Chart(document.getElementById('personChart'), {
      type:'bar',
      data:{
        labels: rows.map(r=>L.short(r.session)),
        datasets:[{ label:'전반적 만족도(Q5)', data: rows.map(r=>r.q5), backgroundColor:'#FF5A00', borderRadius:6, barPercentage:0.5, categoryPercentage:0.6 }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        layout:{ padding:{ top: 14 } },
        scales:{ y:{ min:1, max:5, ticks:{stepSize:1} } },
        plugins:{ legend:{ display:false } }
      }
    });
  }
  sel.onchange = e=>renderPerson(e.target.value);
  renderPerson(personNames[0]);

  // ---- 상위/하위 5명 ----
  function trendHtmlFor(diff){
    if(diff===null) return '<span class="trend-flat">—</span>';
    if(diff>0) return `<span class="trend-up">▲ +${diff}</span>`;
    if(diff<0) return `<span class="trend-down">▼ ${diff}</span>`;
    return '<span class="trend-flat">→ 0</span>';
  }
  const personSummaries = personNames.map(name=>{
    const rows = people[name];
    return {
      name, count: rows.length,
      q5avg: round1(avg(rows.map(r=>r.q5))),
      totalAvg: round1(avg(rows.map(r=>r.avg))),
      diff: rows.length>1 ? rows[rows.length-1].q5 - rows[0].q5 : null
    };
  });
  function renderRankTable(sel, list){
    const tbody = document.querySelector(sel);
    tbody.innerHTML = '';
    list.forEach(p=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="name">${escapeHtml(p.name)}</td><td>${p.count}회</td><td>${p.q5avg}</td><td>${p.totalAvg}</td><td>${trendHtmlFor(p.diff)}</td>`;
      tbody.appendChild(tr);
    });
  }
  const byQ5Desc = [...personSummaries].sort((a,b)=> b.q5avg - a.q5avg || b.totalAvg - a.totalAvg || b.count - a.count);
  renderRankTable('#topTable tbody', byQ5Desc.slice(0, 5));
  renderRankTable('#bottomTable tbody', byQ5Desc.slice(-5).reverse());

  // ---- 주요 의견 ----
  const opinionSelect = document.getElementById('opinionSelect');
  const optAll = document.createElement('option');
  optAll.value = '__ALL__'; optAll.textContent = '전체 회차';
  opinionSelect.appendChild(optAll);
  SESSIONS.forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = L.full(s);
    opinionSelect.appendChild(opt);
  });
  function renderOpinions(filter){
    const rows = filter === '__ALL__' ? RAW : RAW.filter(r=>r.session===filter);
    const goods = rows.filter(r=>!isEmptyOpinion(r.help));
    const bads = rows.filter(r=>!isEmptyOpinion(r.improve));
    document.getElementById('goodCount').textContent = `(${goods.length}건)`;
    document.getElementById('badCount').textContent = `(${bads.length}건)`;
    const fill = (id, list, key)=>{
      const ul = document.getElementById(id);
      ul.innerHTML = list.length ? '' : '<li class="opinion-empty">해당 회차에 등록된 의견이 없습니다.</li>';
      list.forEach(r=>{
        const li = document.createElement('li');
        li.innerHTML = `<span class="who">${escapeHtml(r.name)}</span> (${escapeHtml(L.full(r.session))}) — ${escapeHtml(r[key])}`;
        ul.appendChild(li);
      });
    };
    fill('goodList', goods, 'help');
    fill('badList', bads, 'improve');
  }
  opinionSelect.onchange = e=>renderOpinions(e.target.value);
  renderOpinions('__ALL__');
}

// ==================================================================
// 라우팅: #/  → 교육 목록, #/<courseId> → 해당 교육 대시보드
// ==================================================================
function route(){
  const id = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
  const course = COURSES.find(c=>c.id === id);
  if(course) renderCourse(course); else renderLanding();
}
window.addEventListener('hashchange', route);
route();
