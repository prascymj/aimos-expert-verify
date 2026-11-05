// AI-MOS expert verification page: Google sign-in, the api() client of ../apps-script/Code.gs, and one view per task.
// Everything shown after sign-in comes from the API; the page itself holds no cases, rules or engine results.
(function () {
  const CFG = window.AEV_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: drafts stay in memory */ } }
  };
  const TOK_KEY = 'aev-token';

  const LBL = {
    types: { C1: 'ยาตีกัน', C2: 'ขนาดยา', C3: 'แพ้ยาหรือแพ้ข้ามกลุ่ม', C4: 'ยาซ้ำซ้อน', C5: 'ปรับตามการทำงานของไต', C6: 'ข้อห้ามตามภาวะ (ตั้งครรภ์ ฯลฯ)', RDU: 'ข้อบ่งใช้หรือ RDU', OTHER: 'อื่น ๆ' },
    caseSev: { major: 'รุนแรงมาก (major)', moderate: 'ปานกลาง (moderate)', minor: 'เล็กน้อย (minor)', info: 'ข้อมูลประกอบ (info)' },
    ruleSev: { contraindicated: 'ห้ามใช้ร่วม', major: 'major', moderate: 'moderate', minor: 'minor', none: 'ไม่มีนัยสำคัญ', unsure: 'ไม่แน่ใจ' },
    verifySev: { contraindicated: 'ห้ามใช้ร่วม', major: 'major', moderate: 'moderate', minor: 'minor', none: 'ไม่มีนัยสำคัญ', info: 'info' },
    tgt: { both: 'แพทย์และเภสัชกร', pharm: 'เภสัชกรเท่านั้น', none: 'ไม่ต้องเตือน' },
    decision: { confirm: 'ยืนยันตามที่ทีมเสนอ', edit: 'แก้ไข', reject: 'ไม่ควรมีกฎนี้', unsure: 'ไม่แน่ใจ ขอปรึกษา' },
    years: { lt3: 'น้อยกว่า 3 ปี', '3-5': '3 ถึง 5 ปี', '6-10': '6 ถึง 10 ปี', gt10: 'มากกว่า 10 ปี' },
    setting: { opd: 'ห้องยาผู้ป่วยนอก', ipd: 'ห้องยาผู้ป่วยใน', clinical: 'เภสัชกรรมคลินิก', other: 'อื่น ๆ' },
    hosp: { tertiary: 'โรงพยาบาลศูนย์หรือทั่วไป', community: 'โรงพยาบาลชุมชน', private: 'โรงพยาบาลเอกชน', other: 'อื่น ๆ' },
    board: { none: 'ไม่มี', residency: 'residency หรือวุฒิบัตร', master: 'ปริญญาโทขึ้นไป' },
    role: { owner: 'ผู้วิจัยหลัก', curator: 'เภสัชกรผู้ร่วมวิจัย', rater: 'ผู้ประเมิน' }
  };
  const opts = (map, list, v, blank = 'เลือก') => `<option value="">${blank}</option>` +
    list.map((k) => `<option value="${esc(k)}"${String(v == null ? '' : v) === k ? ' selected' : ''}>${esc(map[k] || k)}</option>`).join('');

  let token = '', me = null, cur = '';
  const st = { draft: {}, opened: {}, caseId: null, filter: 'todo' };

  // ---------------------------------------------------------------- helpers
  let toastTimer = 0;
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3000);
  }
  function fmt(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return iso; }
  }
  function jwtExp(t) {
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return 0; }
  }
  const saveTok = (t) => { token = t; try { sessionStorage.setItem(TOK_KEY, t); } catch (e) {} };
  const loadTok = () => { try { return sessionStorage.getItem(TOK_KEY) || ''; } catch (e) { return token; } };
  const clearTok = () => { token = ''; try { sessionStorage.removeItem(TOK_KEY); } catch (e) {} };
  const draftKey = () => 'aev-draft-' + (me ? me.rater_id : '');
  const keepDrafts = () => store.set(draftKey(), { draft: st.draft, opened: st.opened });

  // text/plain avoids the CORS preflight that Apps Script cannot answer.
  async function api(action, body = {}, retried) {
    if (!token || jwtExp(token) < Date.now() + 20000) { expired(); return { ok: false, code: 'AUTH', message: 'การลงชื่อเข้าใช้หมดอายุ กรุณาลงชื่อใหม่' }; }
    let out;
    try {
      const req = Object.assign({ action, idToken: token }, body);
      if (CFG.mock) out = await window.AEVMock.call(req);
      else {
        const res = await fetch(CFG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req) });
        out = await res.json();
      }
    } catch (e) { out = { ok: false, code: 'NETWORK', message: 'เชื่อมต่อระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่' }; }
    if (!out.ok && out.code === 'BUSY' && !retried) { await new Promise((r) => setTimeout(r, 1500)); return api(action, body, true); }
    if (!out.ok && out.code === 'AUTH') expired(out.message);
    return out;
  }
  function expired(msg) { clearTok(); showSignin(msg || 'การลงชื่อเข้าใช้หมดอายุ กรุณาลงชื่อใหม่ งานที่ยังไม่บันทึกในหน้านี้ยังอยู่'); }

  // ---------------------------------------------------------------- sign-in
  function showSignin(msg) {
    $('#signin').hidden = false; $('#app').hidden = true; $('#who').hidden = true;
    const e = $('#signin-err'); e.hidden = !msg; e.textContent = msg || '';
  }
  const NOT_READY = 'ระบบยังไม่ได้ตั้งค่า (ผู้วิจัยกำลังติดตั้ง) กรุณาลองใหม่ภายหลัง';
  const configured = () => !!(CFG.mock || (CFG.clientId && CFG.apiUrl));
  function initSignin() {
    if (CFG.mock) { window.AEVMock.renderPicker($('#gsi'), onCredential); return; }
    if (!configured()) { showSignin(NOT_READY); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onerror = () => showSignin('โหลดปุ่มลงชื่อเข้าใช้ของ Google ไม่ได้ ตรวจอินเทอร์เน็ตหรือปิดตัวบล็อกโฆษณาแล้วลองใหม่');
    s.onload = () => {
      google.accounts.id.initialize({ client_id: CFG.clientId, callback: (r) => onCredential(r.credential), auto_select: true,
        cancel_on_tap_outside: false, use_fedcm_for_prompt: true, ux_mode: 'popup' });
      google.accounts.id.renderButton($('#gsi'), { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'th', width: 280 });
    };
    document.head.appendChild(s);
  }
  async function onCredential(cred) {
    saveTok(cred);
    $('#signin-err').hidden = true;
    await boot();
  }
  async function boot() {
    token = loadTok();
    if (!token || jwtExp(token) < Date.now() + 20000) { clearTok(); showSignin(configured() ? '' : NOT_READY); return; }
    const r = await api('me');
    if (!r.ok) { if (r.code !== 'AUTH') { clearTok(); showSignin(r.message); } return; }
    me = r.data;
    const saved = store.get(draftKey()) || {};
    st.draft = saved.draft || {}; st.opened = saved.opened || {};
    $('#signin').hidden = true; $('#app').hidden = false; $('#who').hidden = false;
    $('#who-name').textContent = me.display_name ? `${me.display_name} (${me.rater_id})` : me.rater_id;
    $('#who-role').textContent = LBL.role[me.role] || me.role;
    const tabs = tabList();
    const last = store.get('aev-tab-' + me.rater_id);
    show(tabs.some((t) => t.id === last) ? last : tabs[0].id);
  }
  $('#signout').addEventListener('click', () => {
    clearTok(); me = null;
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) {}
    showSignin('ออกจากระบบแล้ว');
  });

  // ---------------------------------------------------------------- tabs
  const R = () => me.rater, C = () => me.curator;
  const consented = () => !!(R() && R().profile && R().profile.consent);
  function tabList() {
    const t = [];
    if (me.role === 'owner') t.push({ id: 'progress', code: 'ความคืบหน้า', name: 'ทุกคนในโครงการ' });
    if (R()) {
      t.push({ id: 'start', code: '1 เริ่มต้น', name: 'ความยินยอมและข้อมูลผู้ตอบ', done: consented() ? 1 : 0, total: 1 });
      t.push({ id: 'cases', code: '2 ติดป้ายเคส', name: `ใบสั่งยาจำลอง ${R().cases.length} เคส`, done: Object.keys(R().labels).length, total: R().cases.length });
      t.push({ id: 'rules', code: '3 ระดับคู่ยา', name: `กฎ ${R().blind_items.length} ข้อ`, done: Object.keys(R().rules).length, total: R().blind_items.length });
    }
    if (C()) {
      t.push({ id: 'verify', code: 'ยืนยันกฎใน KB', name: `กฎ ${C().items.length} ข้อ`, done: Object.keys(C().verify).length, total: C().items.length });
      t.push({ id: 'policy', code: 'นโยบาย รพ.', name: `คำถาม ${C().policy_qs.length} ข้อ`, done: Object.keys(C().policy).length, total: C().policy_qs.length });
    }
    return t;
  }
  function renderTabs() {
    $('#tabs').innerHTML = tabList().map((t) => {
      const pct = t.total ? Math.round(100 * t.done / t.total) : null;
      return `<button type="button" role="tab" class="ftab${t.id === cur ? ' on' : ''}${pct === 100 ? ' complete' : ''}" data-tab="${t.id}" aria-selected="${t.id === cur}">
        <span class="code">${esc(t.code)}</span><span class="name">${esc(t.name)}</span>
        ${pct == null ? '' : `<span class="prog"><span class="mini"><i style="width:${pct}%"></i></span><span class="pct">${t.done}/${t.total}</span></span>`}</button>`;
    }).join('');
    $$('#tabs .ftab').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    document.documentElement.style.setProperty('--hdr', $('#top').offsetHeight + 'px');
  }
  function show(id) {
    cur = id; store.set('aev-tab-' + me.rater_id, id);
    renderTabs();
    ({ progress: viewProgress, start: viewStart, cases: viewCases, rules: viewRules, verify: viewVerify, policy: viewPolicy })[id]();
  }
  const needConsent = () => `<h2>กรุณาให้ความยินยอมก่อน</h2><p class="muted">อยู่ในแท็บ "1 เริ่มต้น" ใช้เวลาไม่ถึง 1 นาที</p>
    <button type="button" class="btn primary" data-go="start">ไปแท็บเริ่มต้น</button>`;
  function wireGo(el) { $$('[data-go]', el).forEach((b) => b.addEventListener('click', () => show(b.dataset.go))); }

  // ---------------------------------------------------------------- 1 start (consent + profile)
  function viewStart() {
    const v = $('#view'), p = R().profile || {}, o = me.options;
    const nCase = Object.keys(R().labels).length, nRule = Object.keys(R().rules).length;
    const all = consented() && nCase === R().cases.length && nRule === R().blind_items.length;
    v.innerHTML = `
      ${all ? '<div class="locked" style="margin-bottom:14px"><b>ทำครบทุกขั้นแล้ว ขอบคุณที่สละเวลา</b><div class="small">ท่านปิดหน้านี้ได้เลย ผู้วิจัยจะติดต่อกลับหากมีข้อสงสัย</div></div>' : ''}
      <h2>ขั้นตอนสำหรับผู้ประเมิน (ราว 40 นาที แบ่งทำหลายครั้งได้)</h2>
      <div class="stats" style="margin-bottom:14px">
        <div class="stat"><div class="k">1 ให้ความยินยอม</div><div class="v">${consented() ? 'เสร็จ' : 'ยังไม่ทำ'}</div></div>
        <div class="stat"><div class="k">2 ติดป้ายใบสั่งยาจำลอง</div><div class="v">${nCase} / ${R().cases.length}</div></div>
        <div class="stat"><div class="k">3 ระดับความรุนแรงของคู่ยา</div><div class="v">${nRule} / ${R().blind_items.length}</div></div>
      </div>
      <h2>ความยินยอมและข้อมูลผู้ตอบ</h2>
      <div class="note" style="margin-bottom:10px">ทีมวิจัยจะนำคำตอบของท่าน (การติดป้ายใบสั่งยาจำลอง และระดับความรุนแรงของคู่ยา) ไปวิเคราะห์และรายงานในงานวิจัยและบทความวิชาการแบบไม่ระบุชื่อ
        ไม่ระบุสถานที่ทำงาน และไม่มีข้อมูลผู้ป่วย จะนำไปใช้ในบทความหลังได้รับการรับรองหรือยกเว้นจากคณะกรรมการจริยธรรมการวิจัยในมนุษย์แล้วเท่านั้น
        ท่านถอนความยินยอมได้ทุกเมื่อโดยเอาเครื่องหมายด้านล่างออกแล้วกดบันทึก หรือแจ้งทีมวิจัย คำตอบของท่านจะไม่ถูกนำไปวิเคราะห์</div>
      <label class="inline"><input type="checkbox" id="consent" ${p.consent ? 'checked' : ''}> ข้าพเจ้ายินยอมให้ใช้คำตอบตามข้างต้น</label>
      <div class="grid3" style="margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        <label class="f">ประสบการณ์งานเภสัชกรรม<select id="years">${opts(LBL.years, o.years, p.years)}</select></label>
        <label class="f">งานหลักตอนนี้<select id="setting">${opts(LBL.setting, o.setting, p.setting)}</select></label>
        <label class="f">ระดับโรงพยาบาล<select id="hosp">${opts(LBL.hosp, o.hosp, p.hosp)}</select></label>
        <label class="f">วุฒิเฉพาะทาง<select id="board">${opts(LBL.board, o.board, p.board)}</select></label>
      </div>
      <div class="row" style="margin-top:12px"><button type="button" class="btn primary" id="save-profile">บันทึก</button>
        <span class="small muted">${p.consent_at ? 'ยินยอมเมื่อ ' + esc(fmt(p.consent_at)) : ''}</span></div>
      <h3>วิธีทำ</h3>
      <ul class="small">
        <li>ขั้นที่ 2: อ่านใบสั่งยาจำลองแต่ละใบ แล้วบันทึกปัญหาที่ท่านพบเอง หรือ "ไม่พบปัญหา" ระบบจะไม่แสดงผลของ AI-MOS เพื่อให้ได้ความเห็นที่เป็นอิสระ บันทึกแล้วแก้ไม่ได้</li>
        <li>ขั้นที่ 3: ให้ระดับความรุนแรงและผู้ที่ควรได้รับคำเตือนของคู่ยา 16 ข้อ ตามความเห็นของท่าน แก้ได้จนกว่าผู้วิจัยจะปิดรอบ</li>
        <li>ร่างที่ยังไม่บันทึกเก็บไว้ในเบราว์เซอร์นี้เท่านั้น ถ้าเปลี่ยนเครื่อง ให้บันทึกก่อน</li>
      </ul>`;
    $('#save-profile').addEventListener('click', async (ev) => {
      const body = { consent: $('#consent').checked };
      ['years', 'setting', 'hosp', 'board'].forEach((f) => { body[f] = $('#' + f).value; });
      if (body.consent && ['years', 'setting', 'hosp', 'board'].some((f) => !body[f])) { toast('กรุณาเลือกข้อมูลผู้ตอบให้ครบ 4 ช่อง', true); return; }
      if (!body.consent && !p.consent) { toast('ต้องให้ความยินยอมก่อนจึงจะเริ่มได้', true); return; }
      if (!body.consent && !confirm('ถอนความยินยอม คำตอบของท่านจะไม่ถูกนำไปวิเคราะห์ ยืนยันหรือไม่')) return;
      ev.target.disabled = true;
      const r = await api('saveProfile', body);
      ev.target.disabled = false;
      if (!r.ok) { toast(r.message, true); return; }
      R().profile = r.data.profile;
      toast(body.consent ? 'บันทึกแล้ว เริ่มขั้นที่ 2 ได้เลย' : 'ถอนความยินยอมแล้ว');
      show(body.consent && !p.consent ? 'cases' : 'start');
    });
  }

  // ---------------------------------------------------------------- 2 blind case labelling
  const drugName = (k) => (R().drug_names && R().drug_names[k]) || k;
  const caseDrugs = (c) => [...new Set(c.items.map((it) => it.drug_id || it.drug))];
  const blankProblem = () => ({ type: 'C1', drugs: [], severity: 'moderate', note: '' });
  function slipHTML(c) {
    const p = c.patient || {}, facts = [`อายุ ${p.age} ปี`, p.sex === 'F' ? 'หญิง' : 'ชาย', p.egfr == null ? 'eGFR ไม่ทราบ' : `eGFR ${p.egfr}`];
    if (p.weight_kg) facts.push(`น้ำหนัก ${p.weight_kg} กก.`);
    let warn = '';
    if (p.pregnant) warn += '<span class="fact warn">ตั้งครรภ์</span>';
    if (p.mechanical_valve) warn += '<span class="fact warn">ลิ้นหัวใจเทียมชนิดกลไก</span>';
    (p.allergies || []).forEach((a) => { warn += `<span class="fact warn">แพ้ ${esc(a.allergen)} (${esc(a.reaction)}, ${esc(a.certainty)})</span>`; });
    const rows = c.items.map((it) => `<tr><td data-h="ยา">${it.is_new ? '<span class="tag-new">ใหม่</span> ' : '<span class="muted small">เดิม</span> '}${esc(it.drug)}
        ${it.strength ? `<span class="small muted">${esc(it.strength)}</span>` : ''}</td>
      <td class="num" data-h="วิธีใช้">${esc(it.sig)}</td><td class="num" data-h="ขนาดต่อวัน">${it.daily_mg == null ? '-' : esc(it.daily_mg) + ' mg/วัน'}</td></tr>`).join('');
    return `<div class="slip"><div class="slip-head"><span class="pt">${esc(c.label_th || 'ผู้ป่วยจำลอง')}</span><span class="small muted">${esc(c.case_id)}</span></div>
      <div class="facts">${facts.map((f) => `<span class="fact">${esc(f)}</span>`).join('')}${warn}</div>
      <table class="t resp"><thead><tr><th>ยา</th><th>วิธีใช้</th><th>ขนาดต่อวัน</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function viewCases() {
    const v = $('#view');
    if (!consented()) { v.innerHTML = needConsent(); wireGo(v); return; }
    const cases = R().cases, labels = R().labels;
    if (!st.caseId || !cases.some((c) => c.case_id === st.caseId)) st.caseId = (cases.find((c) => !labels[c.case_id]) || cases[0]).case_id;
    v.innerHTML = `<div class="split"><div><div class="small muted" style="margin-bottom:6px">${esc(R().case_set_label)}</div>
      <div class="clist" id="clist">${cases.map((c, i) => `<button type="button" data-cid="${esc(c.case_id)}" class="${c.case_id === st.caseId ? 'on' : ''}">
        <span>เคส ${i + 1}</span>${labels[c.case_id] ? '<span class="chip ok">บันทึกแล้ว</span>' : st.draft[c.case_id] ? '<span class="chip warn">ร่าง</span>' : ''}</button>`).join('')}</div></div>
      <div id="case"></div></div>`;
    $$('#clist button', v).forEach((b) => b.addEventListener('click', () => { st.caseId = b.dataset.cid; viewCases(); $('#case').scrollIntoView({ block: 'nearest' }); }));
    renderCase();
  }
  function renderCase() {
    const box = $('#case'), c = R().cases.find((x) => x.case_id === st.caseId), lab = R().labels[c.case_id];
    if (!lab && !st.opened[c.case_id]) { st.opened[c.case_id] = new Date().toISOString(); keepDrafts(); }
    const d = st.draft[c.case_id] || (st.draft[c.case_id] = { no_problem: false, problems: [blankProblem()], confidence: '' });
    const drugs = caseDrugs(c), o = me.options;
    let body;
    if (lab) {
      const sum = lab.no_problem ? 'ไม่พบปัญหา' : lab.problems.map((p) => `${esc(LBL.types[p.type])} [${esc(p.severity)}] ${p.drugs.map((g) => esc(drugName(g))).join(' + ')}${p.note ? ' : ' + esc(p.note) : ''}`).join('<br>');
      body = `<div class="locked"><b>บันทึกแล้ว</b> <span class="small muted">${esc(fmt(lab.blind_saved_at))} ความมั่นใจ ${esc(lab.confidence)}</span><div class="small" style="margin-top:4px">${sum}</div></div>
        <div class="row"><button type="button" class="btn primary" id="next">เคสถัดไปที่ยังไม่ทำ</button></div>`;
    } else {
      body = `<div class="stack"><h3 style="margin:4px 0 0">ท่านพบปัญหาอะไรในใบสั่งยานี้</h3>
        <p class="small muted" style="margin:0">บันทึกตามดุลยพินิจของท่าน ระบบจะไม่แสดงผลของ AI-MOS</p>
        <label class="inline"><input type="checkbox" id="nop" ${d.no_problem ? 'checked' : ''}> ไม่พบปัญหา</label>
        <div id="probs" class="stack" ${d.no_problem ? 'hidden' : ''}>${d.problems.map((p, i) => `<div class="prob" data-i="${i}">
          <div class="row"><label class="f">ประเภท<select data-f="type">${opts(LBL.types, o.types, p.type, 'เลือกประเภท')}</select></label>
            <label class="f">ระดับ<select data-f="severity">${opts(LBL.caseSev, o.caseSev, p.severity, 'เลือกระดับ')}</select></label>
            <button type="button" class="btn quiet" data-act="del" aria-label="ลบปัญหาข้อ ${i + 1}">ลบ</button></div>
          <div class="checks"><span class="small muted">ยาที่เกี่ยวข้อง:</span>${drugs.map((g) => `<label><input type="checkbox" data-drug="${esc(g)}" ${p.drugs.includes(g) ? 'checked' : ''}> ${esc(drugName(g))}</label>`).join('')}</div>
          <input type="text" data-f="note" placeholder="รายละเอียด (ไม่บังคับ)" value="${esc(p.note)}" aria-label="รายละเอียดปัญหาข้อ ${i + 1}" maxlength="500">
        </div>`).join('')}<div><button type="button" class="btn quiet" id="add">เพิ่มปัญหา</button></div></div>
        <div class="row"><label class="f">ความมั่นใจ (1 = ไม่มั่นใจ, 5 = มั่นใจมาก)<select id="conf"><option value="">เลือก</option>${[1, 2, 3, 4, 5].map((n) => `<option${String(d.confidence) === String(n) ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <div class="row"><button type="button" class="btn primary" id="save">บันทึกเคสนี้</button><span class="small muted">บันทึกแล้วแก้ไม่ได้</span></div></div>`;
    }
    box.innerHTML = `<div class="stack">${slipHTML(c)}${body}</div>`;
    if (lab) { $('#next').addEventListener('click', nextCase); return; }
    const sync = () => { keepDrafts(); };
    $('#nop').addEventListener('change', (e) => { d.no_problem = e.target.checked; $('#probs').hidden = d.no_problem; sync(); });
    $$('.prob', box).forEach((el) => {
      const p = d.problems[+el.dataset.i];
      $$('[data-f]', el).forEach((f) => f.addEventListener('input', () => { p[f.dataset.f] = f.value; sync(); }));
      $$('[data-drug]', el).forEach((cb) => cb.addEventListener('change', () => {
        p.drugs = cb.checked ? [...new Set([...p.drugs, cb.dataset.drug])] : p.drugs.filter((g) => g !== cb.dataset.drug); sync();
      }));
      $('[data-act=del]', el).addEventListener('click', () => { d.problems.splice(+el.dataset.i, 1); if (!d.problems.length) d.problems.push(blankProblem()); sync(); renderCase(); });
    });
    $('#add').addEventListener('click', () => { d.problems.push(blankProblem()); sync(); renderCase(); });
    $('#conf').addEventListener('change', (e) => { d.confidence = e.target.value; sync(); });
    $('#save').addEventListener('click', async (ev) => {
      if (!d.no_problem && d.problems.some((p) => !p.type || !p.severity || !p.drugs.length)) { toast('ทุกปัญหาต้องมีประเภท ระดับ และยาที่เกี่ยวข้อง หรือเลือก ไม่พบปัญหา', true); return; }
      if (!d.confidence) { toast('กรุณาเลือกความมั่นใจ', true); return; }
      if (!confirm('บันทึกเคสนี้ บันทึกแล้วแก้ไม่ได้ ยืนยันหรือไม่')) return;
      ev.target.disabled = true;
      const r = await api('saveCase', { case_id: c.case_id, no_problem: d.no_problem, problems: d.no_problem ? [] : d.problems,
        confidence: Number(d.confidence), opened_at: st.opened[c.case_id] || '' });
      ev.target.disabled = false;
      if (!r.ok) { toast(r.message, true); if (r.code === 'LOCKED') await reload(); return; }
      R().labels[c.case_id] = r.data.label; delete st.draft[c.case_id]; keepDrafts();
      toast('บันทึกแล้ว'); nextCase();
    });
  }
  function nextCase() {
    const cases = R().cases, i = cases.findIndex((c) => c.case_id === st.caseId);
    const nxt = cases.slice(i + 1).concat(cases.slice(0, i)).find((c) => !R().labels[c.case_id]);
    if (!nxt) { toast('ติดป้ายครบทุกเคสแล้ว ต่อด้วยขั้นที่ 3'); show('rules'); return; }
    st.caseId = nxt.case_id; renderTabs(); viewCases();
  }
  async function reload() { const r = await api('me'); if (r.ok) { me = r.data; show(cur); } }

  // ---------------------------------------------------------------- 3 blind rule severities
  function viewRules() {
    const v = $('#view');
    if (!consented()) { v.innerHTML = needConsent(); wireGo(v); return; }
    const o = me.options, saved = R().rules;
    v.innerHTML = `<h2>ระดับความรุนแรงของคู่ยาหรือกฎ</h2>
      <p class="small muted">ให้ระดับและผู้ที่ควรได้รับคำเตือนตามความเห็นของท่าน ระบบไม่แสดงค่าที่ทีมหรือแหล่งข้อมูลกำหนด แก้คำตอบได้</p>
      <div class="stack">${R().blind_items.map((it) => {
        const a = saved[it.key] || {};
        return `<div class="item${saved[it.key] ? ' done' : ''}" data-key="${esc(it.key)}">
          <div class="head"><span class="drugs">${esc(it.drugs)}</span><span class="small muted">${esc(it.group)}</span><span class="st">${saved[it.key] ? '<span class="chip ok">บันทึกแล้ว</span>' : ''}</span></div>
          <div class="small">${esc(it.text)}</div>
          <div class="row"><label class="f">ระดับ<select data-f="sev">${opts(LBL.ruleSev, o.ruleSev, a.sev)}</select></label>
            <label class="f">ควรเตือนใคร<select data-f="tgt">${opts(LBL.tgt, o.tgt, a.tgt)}</select></label>
            <label class="f" style="flex:1;min-width:200px">ข้อความเตือนที่ท่านเสนอ (ไม่บังคับ)<input type="text" data-f="note" value="${esc(a.note || '')}" maxlength="500"></label>
            <button type="button" class="btn primary" data-act="save">บันทึก</button></div></div>`;
      }).join('')}</div>`;
    $$('.item', v).forEach((el) => $('[data-act=save]', el).addEventListener('click', async (ev) => {
      const body = { key: el.dataset.key };
      $$('[data-f]', el).forEach((f) => { body[f.dataset.f] = f.value; });
      if (!body.sev || !body.tgt) { toast('กรุณาเลือกระดับและผู้ที่ควรได้รับคำเตือน', true); return; }
      ev.target.disabled = true;
      const r = await api('saveRule', body);
      ev.target.disabled = false;
      if (!r.ok) { toast(r.message, true); return; }
      R().rules[body.key] = r.data.rule; el.classList.add('done'); $('.st', el).innerHTML = '<span class="chip ok">บันทึกแล้ว</span>';
      renderTabs();
      toast(Object.keys(R().rules).length === R().blind_items.length && Object.keys(R().labels).length === R().cases.length ? 'ครบทุกขั้นแล้ว ขอบคุณที่สละเวลา' : 'บันทึกแล้ว');
    }));
  }

  // ---------------------------------------------------------------- KB verification (curator)
  function verifyFields(el, it, a) {
    const dec = $('[data-f=decision]', el).value, p = it.proposal || {}, o = me.options;
    const box = $('.more', el);
    const needNote = (dec === 'confirm' || dec === 'edit') && !p.note;
    let h = '';
    if (dec === 'edit') h += `<div class="row"><label class="f">ระดับที่แก้<select data-f="sev">${opts(LBL.verifySev, o.verifySev, a.sev, 'ไม่แก้')}</select></label>
      <label class="f">เตือนใครที่แก้<select data-f="tgt">${opts(LBL.tgt, o.tgt, a.tgt, 'ไม่แก้')}</select></label></div>`;
    if (dec === 'edit' || needNote) h += `<label class="f">ข้อความเตือน${needNote ? ' (จำเป็น กฎนี้ยังไม่มีข้อความเตือน)' : ' (เขียนเฉพาะถ้าแก้)'}<textarea data-f="note" maxlength="500">${esc(a.note || '')}</textarea></label>`;
    if (dec) h += `<label class="f">เหตุผลหรือแหล่งอ้างอิง${dec === 'reject' ? ' (จำเป็น)' : ' (ไม่บังคับ)'}<textarea data-f="reason" maxlength="500">${esc(a.reason || '')}</textarea></label>`;
    box.innerHTML = h;
  }
  function viewVerify() {
    const v = $('#view'), items = C().items, saved = C().verify, o = me.options;
    const shown = items.filter((it) => st.filter === 'all' || (st.filter === 'todo' ? !saved[it.key] : !!saved[it.key]));
    let grp = '';
    v.innerHTML = `<div class="toolbar"><div><h2 style="margin:0">ยืนยันกฎในฐานความรู้ (สาย ก)</h2>
        <p class="small muted" style="margin:2px 0 0">ทีมเสนอระดับ ผู้ที่ควรได้รับคำเตือน และข้อความเตือนไว้แล้ว เห็นด้วยให้เลือก "ยืนยันตามที่ทีมเสนอ" แก้คำตอบได้ภายหลัง</p></div>
        <label class="f">แสดง<select id="filter"><option value="todo"${st.filter === 'todo' ? ' selected' : ''}>ยังไม่ทำ</option><option value="done"${st.filter === 'done' ? ' selected' : ''}>ทำแล้ว</option><option value="all"${st.filter === 'all' ? ' selected' : ''}>ทั้งหมด</option></select></label></div>
      <div class="bar" style="margin-bottom:10px"><i style="width:${Math.round(100 * Object.keys(saved).length / items.length)}%"></i></div>
      ${shown.length ? '' : `<p class="muted">${st.filter === 'todo' ? 'ทำครบทุกข้อแล้ว ขอบคุณที่สละเวลา' : 'ไม่มีรายการ'}</p>`}
      <div class="stack">${shown.map((it) => {
        const a = saved[it.key] || {}, p = it.proposal || {};
        const head = it.group !== grp ? `<h3 class="grp">${esc(grp = it.group)}</h3>` : '';
        return `${head}<div class="item${saved[it.key] ? ' done' : ''}" data-key="${esc(it.key)}">
          <div class="head"><span class="key">${esc(it.key)}</span><span class="drugs">${esc(it.drugs)}</span><span class="st">${saved[it.key] ? `<span class="chip ok">${esc(LBL.decision[a.decision])}</span>` : ''}</span></div>
          ${it.text && it.text !== p.note ? `<div class="small">${esc(it.text)}</div>` : ''}
          <dl class="prop"><dt>ระดับที่ทีมเสนอ</dt><dd>${esc(LBL.verifySev[p.sev] || p.sev || '-')}</dd><dt>เตือนใคร</dt><dd>${esc(LBL.tgt[p.tgt] || p.tgt || '-')}</dd>
            <dt>ข้อความเตือน</dt><dd>${p.note ? esc(p.note) : '<span class="chip warn">ยังไม่มี กรุณาเขียน</span>'}</dd></dl>
          <div class="row"><label class="f">การตัดสินใจ<select data-f="decision">${opts(LBL.decision, o.decision, a.decision)}</select></label></div>
          <div class="more stack"></div>
          <div class="row"><button type="button" class="btn primary" data-act="save">บันทึก</button>${a.saved_at ? `<span class="small muted">บันทึกล่าสุด ${esc(fmt(a.saved_at))}</span>` : ''}</div></div>`;
      }).join('')}</div>`;
    $('#filter').addEventListener('change', (e) => { st.filter = e.target.value; viewVerify(); });
    $$('.item', v).forEach((el) => {
      const it = items.find((x) => x.key === el.dataset.key), a = saved[it.key] || {};
      verifyFields(el, it, a);
      $('[data-f=decision]', el).addEventListener('change', () => verifyFields(el, it, a));
      $('[data-act=save]', el).addEventListener('click', async (ev) => {
        const body = { key: it.key };
        $$('[data-f]', el).forEach((f) => { body[f.dataset.f] = f.value; });
        if (!body.decision) { toast('กรุณาเลือกการตัดสินใจ', true); return; }
        ev.target.disabled = true;
        const r = await api('saveVerify', body);
        ev.target.disabled = false;
        if (!r.ok) { toast(r.message, true); return; }
        C().verify[it.key] = r.data.verify;
        toast('บันทึกแล้ว'); renderTabs();
        if (st.filter === 'todo') { el.remove(); if (!$('.item', v)) viewVerify(); }
        else { el.classList.add('done'); $('.st', el).innerHTML = `<span class="chip ok">${esc(LBL.decision[body.decision])}</span>`; }
      });
    });
  }

  function viewPolicy() {
    const v = $('#view'), saved = C().policy;
    v.innerHTML = `<h2>นโยบายของโรงพยาบาล</h2><p class="small muted">ใช้ปรับรูปแบบตารางคู่ยาให้ตรงกับระบบที่โรงพยาบาลใช้จริง</p>
      <div class="stack">${C().policy_qs.map((q) => {
        const a = saved[q.qid] || {};
        return `<div class="item${saved[q.qid] ? ' done' : ''}" data-q="${esc(q.qid)}"><div class="head"><span class="key">${esc(q.qid)}</span><span class="st">${saved[q.qid] ? '<span class="chip ok">บันทึกแล้ว</span>' : ''}</span></div>
          <div>${esc(q.text)}</div>
          <div class="checks" role="radiogroup" aria-label="${esc(q.qid)}">${q.choices.map((ch) => `<label><input type="radio" name="${esc(q.qid)}" value="${esc(ch)}" ${a.answer === ch ? 'checked' : ''}> ${esc(ch)}</label>`).join('')}</div>
          <label class="f">รายละเอียดเพิ่มเติม<textarea data-f="detail" maxlength="500">${esc(a.detail || '')}</textarea></label>
          <div class="row"><button type="button" class="btn primary" data-act="save">บันทึก</button></div></div>`;
      }).join('')}</div>`;
    $$('.item', v).forEach((el) => $('[data-act=save]', el).addEventListener('click', async (ev) => {
      const ch = $('input[type=radio]:checked', el);
      if (!ch) { toast('กรุณาเลือกคำตอบ', true); return; }
      ev.target.disabled = true;
      const r = await api('savePolicy', { qid: el.dataset.q, answer: ch.value, detail: $('[data-f=detail]', el).value });
      ev.target.disabled = false;
      if (!r.ok) { toast(r.message, true); return; }
      C().policy[el.dataset.q] = r.data.policy; el.classList.add('done'); $('.st', el).innerHTML = '<span class="chip ok">บันทึกแล้ว</span>';
      renderTabs(); toast('บันทึกแล้ว');
    }));
  }

  // ---------------------------------------------------------------- owner progress
  async function viewProgress() {
    const v = $('#view');
    v.innerHTML = '<p class="muted">กำลังโหลด</p>';
    const r = await api('progress');
    if (cur !== 'progress') return;
    if (!r.ok) { v.innerHTML = `<p class="err">${esc(r.message)}</p>`; return; }
    const cell = (n, t) => (t ? `${n}/${t}` : '');
    const ppl = r.data.people;
    v.innerHTML = `<div class="toolbar"><div><h2 style="margin:0">ความคืบหน้า</h2><p class="small muted" style="margin:2px 0 0">ชุดเคส ${esc(r.data.case_set)} ข้อมูลรุ่น ${esc(r.data.data_version)}
      เพิ่มผู้ประเมินที่ชีต raters (อีเมล, rater_id, role, active = TRUE)</p></div><button type="button" class="btn" id="refresh">โหลดใหม่</button></div>
      <table class="t resp"><thead><tr><th>รหัส</th><th>ชื่อที่แสดง</th><th>บทบาท</th><th>ยินยอม</th><th>เคส</th><th>คู่ยา</th><th>ยืนยันกฎ</th><th>นโยบาย</th><th>ล่าสุด</th></tr></thead>
      <tbody>${ppl.map((p) => `<tr><td data-h="รหัส"><b>${esc(p.rater_id)}</b>${p.active ? '' : ' <span class="chip todo">ปิดใช้</span>'}</td><td data-h="ชื่อ">${esc(p.display_name)}</td>
        <td data-h="บทบาท">${esc(LBL.role[p.role] || p.role)}</td><td data-h="ยินยอม">${p.role === 'curator' ? '-' : p.consent ? '<span class="chip ok">ยินยอม</span>' : '<span class="chip warn">ยังไม่</span>'}</td>
        <td class="num" data-h="เคส">${p.role === 'curator' ? '-' : cell(p.cases, p.cases_total)}</td><td class="num" data-h="คู่ยา">${p.role === 'curator' ? '-' : cell(p.rules, p.rules_total)}</td>
        <td class="num" data-h="ยืนยันกฎ">${p.role === 'rater' ? '-' : cell(p.verify, p.verify_total)}</td><td class="num" data-h="นโยบาย">${p.role === 'rater' ? '-' : cell(p.policy, p.policy_total)}</td>
        <td data-h="ล่าสุด" class="small">${esc(fmt(p.last_at))}</td></tr>`).join('')}</tbody></table>
      <p class="small muted">แถว OWNER คือการทดลองของผู้วิจัย ไม่ถูกนำไปวิเคราะห์ (tools/sheet_to_labels.py นับเฉพาะ role = rater ที่ยินยอม)</p>`;
    $('#refresh').addEventListener('click', viewProgress);
  }

  window.addEventListener('resize', () => { if (me) document.documentElement.style.setProperty('--hdr', $('#top').offsetHeight + 'px'); });
  initSignin();
  boot();
})();
