/* JHCAPP Frontend (GitHub Pages)
 * Talks to Apps Script via form-POST (no CORS preflight).
 * Stores token in localStorage.
 */
(() => {
  'use strict';

  const API_URL = "https://script.google.com/macros/s/AKfycbzBPYjBlzVYNEndJ12Cy4rf1P61epLUwnsdi8zQ7GIXPwVFq60o9MJ-ClqsWZQpKCug/exec";

if (!API_URL || !API_URL.startsWith("https://script.google.com/macros/s/")) {
  alert("FATAL: GAS API URL is missing or invalid.");
  throw new Error("Missing or invalid GAS API URL");
}

  const $ = (id) => document.getElementById(id);
  const q = (sel, root=document) => root.querySelector(sel);
  const qa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const state = {
    token: localStorage.getItem('jhc_token') || '',
    me: null,
    patients: [],
    visits: [],
    activeVisit: null,
    checklist: {},
    locked: false,
    rec: { mediaRecorder: null, chunks: [], blob: null, startedAt: null, endedAt: null }
  };

  function setNet(text){ $('net_state').textContent = text; }

  function showAuth(msg=''){
    $('auth_overlay').classList.remove('hidden');
    $('app').classList.add('hidden');
    $('auth_msg').textContent = msg;
    clearAppUI();
  }
  function showApp(){
    $('auth_overlay').classList.add('hidden');
    $('app').classList.remove('hidden');
  }

  function clearAppUI(){
    $('visits_list').innerHTML = '';
    $('create_patient').innerHTML = '';
    $('patient_select').innerHTML = '';
    $('calendar_list').innerHTML = '';
    $('active_visit').value = '';
    $('soc_form').innerHTML = '';
    $('rendered_note').textContent = '';
    $('doc_msg').textContent = '';
    $('visit_msg').textContent = '';
    $('patient_msg').textContent = '';
    $('admin_msg').textContent = '';
    $('admin_output').textContent = '';
    state.activeVisit = null;
    state.checklist = {};
    state.locked = false;
  }

  function escapeHtml(s){
    return String(s || '')
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'","&#039;");
  }

  async function api(action, payload={}){
    if (!API_URL || API_URL.includes('PASTE_YOUR_GAS_EXEC_URL_HERE')) {
      throw new Error('Missing GAS URL. Open config.js and paste your Apps Script /exec URL.');
    }

    const body = new URLSearchParams();
    body.set('action', action);
    if (state.token) body.set('token', state.token);
    body.set('payload', JSON.stringify(payload || {}));

    setNet('Working…');

    const res = await fetch(API_URL, {
      method: 'POST',
      body, // form-encoded => no preflight
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('Bad API response'); }

    if (!json.ok) throw new Error(json.error || 'API error');
    setNet('Idle');
    return json;
  }

  /* ---------- Auth ---------- */
  function setTabs(which){
    $('tab_login').classList.toggle('active', which === 'login');
    $('tab_signup').classList.toggle('active', which === 'signup');
    $('login_panel').classList.toggle('hidden', which !== 'login');
    $('signup_panel').classList.toggle('hidden', which !== 'signup');
    $('auth_msg').textContent = '';
  }

  async function signup(){
    try{
      $('auth_msg').textContent = '';
      const email = $('signup_email').value.trim();
      const password = $('signup_pass').value;
      const out = await api('auth.signup', { email, password });
      state.token = out.token;
      localStorage.setItem('jhc_token', state.token);
      await bootstrap();
    }catch(e){
      $('auth_msg').textContent = e.message || String(e);
    }
  }

  async function login(){
    try{
      $('auth_msg').textContent = '';
      const email = $('login_email').value.trim();
      const password = $('login_pass').value;
      const out = await api('auth.login', { email, password });
      state.token = out.token;
      localStorage.setItem('jhc_token', state.token);
      await bootstrap();
    }catch(e){
      $('auth_msg').textContent = e.message || String(e);
    }
  }

  function logout(){
    state.token = '';
    state.me = null;
    localStorage.removeItem('jhc_token');
    showAuth('Logged out.');
  }

  /* ---------- Bootstrap ---------- */
  async function bootstrap(){
    try{
      const out = await api('bootstrap', {});
      state.me = out.me;
      state.patients = out.patients || [];
      state.visits = out.visits || [];
      $('me_email').textContent = state.me.email;
      $('me_role').textContent = state.me.role;
      $('admin_nav').style.display = (['admin','supervisor'].includes(state.me.role)) ? '' : 'none';

      renderPatientSelects();
      renderVisits();
      showApp();
      closeSidebar();
    }catch(e){
      logout();
      showAuth(e.message || 'Session expired. Please login again.');
    }
  }

  /* ---------- Navigation ---------- */
  function setView(name){
    qa('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    qa('.view').forEach(v => v.classList.add('hidden'));
    $('view_' + name).classList.remove('hidden');
    closeSidebar();
  }

  function toggleSidebar(){
    $('sidebar').classList.toggle('open');
  }
  function closeSidebar(){
    $('sidebar').classList.remove('open');
  }

  /* ---------- Patients ---------- */
  function renderPatientSelects(){
    const opts = ['<option value="">Select patient…</option>']
      .concat(state.patients.map(p => `<option value="${escapeHtml(p.patient_id)}">${escapeHtml(p.last)}, ${escapeHtml(p.first)} (${escapeHtml(p.patient_id)})</option>`));
    $('create_patient').innerHTML = opts.join('');
    $('patient_select').innerHTML = opts.join('');
  }

  function fillPatientForm(p){
    $('p_first').value = p?.first || '';
    $('p_last').value = p?.last || '';
    $('p_dob').value = p?.dob || '';
    $('p_phone').value = p?.phone || '';
    $('p_address').value = p?.address || '';
    $('p_notes').value = p?.notes || '';
  }

  async function savePatient(){
    try{
      const patient_id = $('patient_select').value.trim() || '';
      const patient = {
        patient_id,
        first: $('p_first').value.trim(),
        last: $('p_last').value.trim(),
        dob: $('p_dob').value.trim(),
        phone: $('p_phone').value.trim(),
        address: $('p_address').value.trim(),
        notes: $('p_notes').value.trim(),
        active: 'Y'
      };
      const out = await api('patients.upsert', { patient });
      $('patient_msg').textContent = 'Saved ' + out.patient.patient_id;
      await bootstrap(); // refresh lists
      $('patient_select').value = out.patient.patient_id;
      fillPatientForm(out.patient);
    }catch(e){
      $('patient_msg').textContent = e.message || String(e);
    }
  }

  /* ---------- Visits ---------- */
  function renderVisits(){
    const box = $('visits_list');
    if (!state.visits.length){
      box.innerHTML = `<div class="item"><b>No visits yet</b><div class="muted">Create one on the left.</div></div>`;
      return;
    }
    box.innerHTML = state.visits.map(v => `
      <div class="item">
        <div><b>${escapeHtml(v.visit_id)}</b> — ${escapeHtml(v.visit_type)} — ${escapeHtml(v.status)}</div>
        <div class="muted">patient: ${escapeHtml(v.patient_id)} | start: ${escapeHtml(v.scheduled_start || '')}</div>
        <div class="row">
          <button class="btn" type="button" data-open="${escapeHtml(v.visit_id)}">Open</button>
        </div>
      </div>
    `).join('');
    qa('[data-open]', box).forEach(btn => btn.addEventListener('click', () => openVisit(btn.dataset.open)));
  }

  async function createVisit(){
    try{
      const patient_id = $('create_patient').value.trim();
      if (!patient_id) return alert('Select a patient.');
      const visit = {
        patient_id,
        visit_type: $('create_type').value,
        scheduled_start: $('create_start').value,
        scheduled_end: $('create_end').value,
        share_to_calendar: $('create_share').value
      };
      const out = await api('visits.create', { visit });
      $('visit_msg').textContent = 'Created ' + out.visit.visit_id;
      await bootstrap();
      await openVisit(out.visit.visit_id);
    }catch(e){
      $('visit_msg').textContent = e.message || String(e);
    }
  }

  async function openVisit(visit_id){
    $('active_visit').value = visit_id;
    state.activeVisit = visit_id;
    $('rendered_note').textContent = '';
    $('doc_msg').textContent = '';
    await loadChecklistAndRendered();
  }

  /* ---------- Checklist + Autosave ---------- */
  const CHECKLIST_SCHEMAS = {
    SOC: [
      header('Header'),
      f('insurance','Insurance *'),
      f('admit_date','Admit date *','date'),
      f('recent_hosp_related_to','Recent hospitalization / related to *'),
      f('homebound_due_to_phrase','Homebound due to (exact phrase) *'),
      f('referred_by_dr','Referred by DR. *'),
      f('assist_with_adls','Assist with ADLs *'),

      header('Goal + Plan'),
      f('goal_quote','GOAL: "___" *'),
      f('additional_comments','ADDITIONAL COMMENTS *'),
      f('plan_sentence','PLAN (exact sentence if different)'),

      header('Advance Directive/POA'),
      f('ad_poa_educated','Patient/caregiver instructed/educated *','yesno'),
      f('ad_poa_reviewed','Forms provided and reviewed *','yesno'),
      f('ad_poa_left','Forms left in home *','yesno'),

      header('Medication Safety'),
      f('med_changed_updated','Changed/Updated medications *'),
      f('med_reconciliation','Performed medication reconciliation this date *'),
      f('meds_present','All medications present in home *'),

      header('Skilled Obs + Dx flags'),
      f('teaching_training_for','Teaching and training for *'),
      f('vitals_within_params','Vitals within parameters? *'),
      f('who_notified','Who notified (Case Manager/PCP) *'),
      f('dx_htn','HTN *','yesno'),
      f('dx_copd','COPD *','yesno'),
      f('dx_depression','DEPRESSION *','yesno'),
      f('dx_dmii','DMII *','yesno'),
      f('dx_chf','CHF *','yesno'),

      header('Cardiovascular'),
      f('cv_edema','Edema *'),
      f('cv_palpitations','Palpitations *'),
      f('cv_endurance','Endurance *'),
      f('cv_unable_weigh','Unable to weigh due to *'),
      f('cv_right_cm','RIGHT (ankle/calf) cm *'),
      f('cv_left_cm','LEFT (ankle/calf) cm *'),

      header('Resp / GI / Wound / Infection'),
      f('resp_uses_o2','Uses supplemental oxygen *','yesno'),
      f('resp_o2_lpm','Oxygen L/min'),
      f('resp_o2_route','Route (nasal cannula)'),
      f('resp_nebulizer','Nebulizer *','yesno'),
      f('resp_sob','Short of Breath *'),
      f('gi_last_bm','Last bowel movement *','date'),
      f('gi_appetite','Appetite *'),
      f('wound_statement','WOUND statement *','textarea'),
      f('covid_symptoms_reported','Covid symptoms reported *','yesno'),
      f('covid_symptoms_detail','Symptoms detail/actions','textarea'),

      header('Home safety + Emergency preparedness + PHQ-2'),
      f('home_safety_teaching','Home safety teaching (exact phrase) *','textarea'),
      f('emerg_family','FAMILY *'),
      f('emerg_with','with ___ *'),
      f('emerg_special_needs','special needs of ___ *'),
      f('phq2_interest','PHQ-2 interest answer *'),
      f('phq2_depressed','PHQ-2 depressed answer *'),

      header('HEP + MD/risks/goals'),
      f('gait_balance_training','GAIT/BALANCE TRAINING','textarea'),
      f('transfer_training','TRANSFER TRAINING','textarea'),
      f('ther_ex','THER EX','textarea'),
      f('hep_details','HEP details *','textarea'),
      f('attending_md','Attending MD *'),
      f('primary_dx_focus','Primary Dx / focus of care *'),
      f('rehosp_risks','Re-hospitalization risks *','textarea'),
      f('anticipated_needs_future','Anticipated needs/education future visits *','textarea'),
      f('short_term_weeks','Short term goals weeks *'),
      f('long_term_weeks','Long term goals weeks *'),
      f('patient_identified_goal','Patient identified goal *','textarea'),

      header('Clinical (quick)'),
      f('history','HISTORY','textarea'),
      f('rom','ROM','textarea'),
      f('strength','STRENGTH','textarea'),
      f('endurance_obj','ENDURANCE','textarea'),
      f('sensation','SENSATION','textarea'),
      f('transfers','TRANSFERS','textarea'),
      f('gait','GAIT','textarea'),
      f('tinetti','TINETTI','textarea'),
      f('balance_static','BALANCE STATIC STANDING','textarea'),
      f('disease_mgmt','DISEASE MGMT','textarea'),
      f('special_instructions_precautions','SPECIAL INSTRUCTIONS/PRECAUTIONS','textarea'),
    ],

    InitialEval: [
      header('Initial Eval'),
      f('ie_subjective','SUBJECTIVE','textarea'),
      f('ie_homebound','HOMEBOUND','textarea'),
      f('ie_referred_by','REFERRED BY','textarea'),
      f('ie_living','LIVING ARRANGEMENTS','textarea'),
      f('ie_history','HISTORY','textarea'),
      f('ie_plof','PRIOR LEVEL OF FUNCTION','textarea'),
      f('ie_falls','FALL HISTORY','textarea'),
      header('Objective'),
      f('ie_rom','ROM','textarea'),
      f('ie_strength','STRENGTH','textarea'),
      f('ie_endurance','ENDURANCE','textarea'),
      f('ie_sensation','SENSATION','textarea'),
      f('ie_transfers','TRANSFERS','textarea'),
      f('ie_gait','GAIT','textarea'),
      f('ie_balance','BALANCE','textarea'),
      f('ie_tinetti','TINETTI','textarea'),
      header('Skilled'),
      f('ie_vitals','VITALS','textarea'),
      f('ie_disease_mgmt','DISEASE MGMT','textarea'),
      f('ie_precautions','SPECIAL INSTRUCTIONS/PRECAUTIONS','textarea'),
      f('ie_home_safety','HOME SAFETY','textarea'),
      f('ie_phq2','PHQ-2','textarea'),
      header('Interventions'),
      f('ie_gait_training','GAIT/BALANCE TRAINING','textarea'),
      f('ie_transfer_training','TRANSFER TRAINING','textarea'),
      f('ie_therex','THER EX','textarea'),
      header('Goals / Progress'),
      f('ie_goals_progress','GOALS / PROGRESS','textarea'),
    ]
  };

  function header(text){ return { type:'header', text }; }
  function f(key, label, kind='text'){ return { type:'field', key, label, kind }; }

  function currentVisitType(){
    const v = state.visits.find(x => x.visit_id === state.activeVisit);
    return v ? String(v.visit_type || 'SOC') : 'SOC';
  }

  function renderChecklistForm(type){
    const schema = CHECKLIST_SCHEMAS[type] || CHECKLIST_SCHEMAS.SOC;
    $('checklist_title').textContent = (type === 'SOC') ? 'SOC Checklist' : (type + ' Checklist');
    const html = [];
    for (const item of schema){
      if (item.type === 'header'){
        html.push(`<div class="pill" style="margin:10px 0 8px; color:var(--text);">${escapeHtml(item.text)}</div>`);
        continue;
      }
      const id = 'k_' + item.key;
      if (item.kind === 'textarea'){
        html.push(`<div class="socrow"><div class="full"><label>${escapeHtml(item.label)}</label><textarea id="${id}" rows="2"></textarea></div></div>`);
      } else if (item.kind === 'yesno'){
        html.push(`<div class="socrow"><div class="full"><label>${escapeHtml(item.label)}</label><select id="${id}"><option value=""></option><option value="YES">YES</option><option value="NO">NO</option></select></div></div>`);
      } else if (item.kind === 'date'){
        html.push(`<div class="socrow"><div class="full"><label>${escapeHtml(item.label)}</label><input id="${id}" type="date"/></div></div>`);
      } else {
        html.push(`<div class="socrow"><div class="full"><label>${escapeHtml(item.label)}</label><input id="${id}"/></div></div>`);
      }
    }
    $('soc_form').innerHTML = html.join('');
    // attach autosave
    qa('#soc_form input, #soc_form textarea, #soc_form select').forEach(el => el.addEventListener('input', scheduleAutosave));
  }

  function collectChecklist(type){
    const schema = CHECKLIST_SCHEMAS[type] || CHECKLIST_SCHEMAS.SOC;
    const out = {};
    for (const item of schema){
      if (item.type !== 'field') continue;
      const el = $('k_' + item.key);
      if (!el) continue;
      out[item.key] = (el.value || '').trim();
    }
    return out;
  }

  function fillChecklist(type, data){
    const schema = CHECKLIST_SCHEMAS[type] || CHECKLIST_SCHEMAS.SOC;
    for (const item of schema){
      if (item.type !== 'field') continue;
      const el = $('k_' + item.key);
      if (!el) continue;
      el.value = (data && data[item.key] != null) ? String(data[item.key]) : '';
    }
  }

  let autosaveTimer = null;
  function scheduleAutosave(){
    if (state.locked) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveChecklist(), 900);
  }

  async function loadChecklistAndRendered(){
    const visit_id = $('active_visit').value.trim();
    if (!visit_id) return;
    const type = currentVisitType();
    renderChecklistForm(type);

    try{
      const soc = await api('soc.get', { visit_id });
      state.checklist = soc.soc || {};
      state.locked = !!soc.locked;
      fillChecklist(type, state.checklist);

      const rn = await api('notes.getRendered', { visit_id });
      $('rendered_note').textContent = rn.note_text || '';
      state.locked = (rn.locked === 'Y') || state.locked;
      applyLockState();
    }catch(e){
      $('doc_msg').textContent = e.message || String(e);
    }
  }

  function applyLockState(){
    const disabled = !!state.locked;
    qa('#soc_form input, #soc_form textarea, #soc_form select').forEach(el => el.disabled = disabled);
    $('btn_save').disabled = disabled;
    $('btn_generate').disabled = disabled;
    $('rec_upload').disabled = disabled ? true : $('rec_upload').disabled;
    $('doc_msg').textContent = disabled ? 'Signed/locked: checklist is read-only.' : '';
  }

  async function saveChecklist(){
    const visit_id = $('active_visit').value.trim();
    if (!visit_id) return;
    if (state.locked) return;

    const type = currentVisitType();
    const soc = collectChecklist(type);

    try{
      await api('soc.set', { visit_id, soc });
      $('doc_msg').textContent = 'Saved.';
    }catch(e){
      $('doc_msg').textContent = e.message || String(e);
    }
  }

  async function generateNote(){
    const visit_id = $('active_visit').value.trim();
    if (!visit_id) return alert('Open a visit first.');
    if (state.locked) return alert('This visit is signed/locked.');
    await saveChecklist();
    try{
      const out = await api('notes.render', { visit_id });
      $('rendered_note').textContent = out.note_text || '';
      $('doc_msg').textContent = 'Generated.';
    }catch(e){
      $('doc_msg').textContent = e.message || String(e);
    }
  }

  async function signAndLock(){
    const visit_id = $('active_visit').value.trim();
    if (!visit_id) return alert('Open a visit first.');
    if (!confirm('Sign & lock? No edits after this.')) return;
    try{
      await api('notes.sign', { visit_id });
      state.locked = true;
      applyLockState();
      $('doc_msg').textContent = 'Signed & locked.';
    }catch(e){
      $('doc_msg').textContent = e.message || String(e);
    }
  }

  /* ---------- Calendar ---------- */
  async function loadCalendar(){
    try{
      const out = await api('calendar.list', { fromIso: $('cal_from').value.trim() || null, toIso: $('cal_to').value.trim() || null });
      const rows = out.rows || [];
      $('calendar_list').innerHTML = rows.map(r => `
        <div class="item">
          <div><b>${escapeHtml(r.start || '')}</b> — ${escapeHtml(r.patient_label || '')}</div>
          <div class="muted">${escapeHtml(r.address || '(address hidden)')}</div>
          <div class="muted">${escapeHtml(r.clinician_email || '')} | visit: ${escapeHtml(r.visit_id || '')}</div>
        </div>
      `).join('');
    }catch(e){
      $('calendar_list').innerHTML = `<div class="item"><b>Error</b><div class="muted">${escapeHtml(e.message || String(e))}</div></div>`;
    }
  }

  /* ---------- Emergency ---------- */
  async function triggerEmergency(){
    const visit_id = $('active_visit').value.trim();
    if (!visit_id) return alert('Open a visit first.');

    const location = await getLocationString().catch(()=>'');
    const type = prompt('Emergency type (fall, threat, medical):', 'Emergency') || 'Emergency';
    const severity = prompt('Severity (Low/Medium/High/Critical):', 'High') || 'High';
    const situation = prompt('Brief situation:', '') || '';

    try{
      const out = await api('emergency.trigger', { visit_id, type, severity, situation, location });
      alert(`Emergency logged: ${out.incident_id}`);
      // If they confirm, the phone dialer opens. The app stays open.
      if (confirm('Call 911 now?')) window.location.href = 'tel:911';
    }catch(e){
      alert(e.message || String(e));
    }
  }

  async function getLocationString(){
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve('');
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`),
        () => resolve(''),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  /* ---------- Audio recording ---------- */
  function pickMimeType(){
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (const c of candidates) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    return '';
  }
  function blobToBase64(blob){
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
      r.readAsDataURL(blob);
    });
  }

  async function startRecording(){
    const visit_id = $('active_visit').value.trim();
    if (!visit_id) return alert('Open a visit first.');
    if (!navigator.mediaDevices?.getUserMedia) return alert('Mic not available in this browser.');

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMimeType();
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

    state.rec = { mediaRecorder: mr, chunks: [], blob: null, startedAt: new Date().toISOString(), endedAt: null };

    mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) state.rec.chunks.push(e.data); };
    mr.onstop = () => {
      state.rec.endedAt = new Date().toISOString();
      state.rec.blob = new Blob(state.rec.chunks, { type: mr.mimeType || 'audio/webm' });
      $('rec_playback').src = URL.createObjectURL(state.rec.blob);
      $('rec_upload').disabled = state.locked;
      $('rec_status').textContent = `Recorded ${Math.round(state.rec.blob.size/1024)} KB`;
      stream.getTracks().forEach(t => t.stop());
    };

    mr.start();
    $('rec_start').disabled = true;
    $('rec_stop').disabled = false;
    $('rec_status').textContent = 'Recording...';
  }

  function stopRecording(){
    const mr = state.rec.mediaRecorder;
    if (!mr) return;
    mr.stop();
    $('rec_start').disabled = false;
    $('rec_stop').disabled = true;
  }

  async function uploadRecording(){
    const visit_id = $('active_visit').value.trim();
    if (!visit_id) return alert('Open a visit first.');
    if (state.locked) return alert('This visit is signed/locked.');
    if (!state.rec.blob) return alert('No recording available.');

    $('rec_status').textContent = 'Encoding...';
    const base64 = await blobToBase64(state.rec.blob);

    $('rec_status').textContent = 'Uploading...';
    const retention_days = parseInt(($('rec_retention').value || '30'), 10);

    try{
      const out = await api('recordings.upload', {
        visit_id,
        filename: `rec_${visit_id}_${Date.now()}.webm`,
        mimeType: state.rec.blob.type || 'audio/webm',
        base64,
        started_at: state.rec.startedAt,
        ended_at: state.rec.endedAt,
        retention_days
      });
      $('rec_status').innerHTML = `Uploaded. (Saved to Drive)`;
      $('rec_upload').disabled = true;
    }catch(e){
      $('rec_status').textContent = e.message || String(e);
    }
  }

  /* ---------- Admin ---------- */
  async function adminSetPassword(){
    try{
      const email = $('admin_user_email').value.trim();
      const newPassword = $('admin_user_pass').value;
      const out = await api('auth.setPassword', { email, newPassword });
      $('admin_msg').textContent = 'Password set.';
    }catch(e){
      $('admin_msg').textContent = e.message || String(e);
    }
  }

  async function adminSetRole(){
    try{
      const email = $('admin_user_email').value.trim();
      const role = $('admin_user_role').value;
      const out = await api('auth.setRole', { email, role });
      $('admin_msg').textContent = 'Role updated.';
    }catch(e){
      $('admin_msg').textContent = e.message || String(e);
    }
  }

  async function adminLookupPatient(){
    try{
      const term = prompt('Enter patient id or last name:','') || '';
      const out = await api('admin.lookupPatient', { term });
      $('admin_output').textContent = JSON.stringify(out.result || {}, null, 2);
      $('admin_msg').textContent = '';
    }catch(e){
      $('admin_msg').textContent = e.message || String(e);
    }
  }

  /* ---------- Events ---------- */
  function bind(){
    $('tab_login').addEventListener('click', () => setTabs('login'));
    $('tab_signup').addEventListener('click', () => setTabs('signup'));
    $('btn_signup').addEventListener('click', signup);
    $('btn_login').addEventListener('click', login);
    $('btn_logout').addEventListener('click', logout);

    $('btn_refresh').addEventListener('click', bootstrap);
    $('btn_create_visit').addEventListener('click', createVisit);
    $('btn_load').addEventListener('click', loadChecklistAndRendered);
    $('btn_save').addEventListener('click', saveChecklist);
    $('btn_generate').addEventListener('click', generateNote);
    $('btn_sign').addEventListener('click', signAndLock);

    $('btn_cal_load').addEventListener('click', loadCalendar);

    $('btn_emergency').addEventListener('click', triggerEmergency);

    $('rec_start').addEventListener('click', startRecording);
    $('rec_stop').addEventListener('click', stopRecording);
    $('rec_upload').addEventListener('click', uploadRecording);

    $('patient_select').addEventListener('change', () => {
      const p = state.patients.find(x => x.patient_id === $('patient_select').value) || null;
      fillPatientForm(p);
    });
    $('btn_new_patient').addEventListener('click', () => { $('patient_select').value=''; fillPatientForm(null); });
    $('btn_save_patient').addEventListener('click', savePatient);

    $('btn_admin_setpass').addEventListener('click', adminSetPassword);
    $('btn_admin_setrole').addEventListener('click', adminSetRole);
    $('btn_admin_lookup_patient').addEventListener('click', adminLookupPatient);

    qa('.navbtn').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
    $('btn_menu').addEventListener('click', toggleSidebar);

    // close sidebar if clicking outside on mobile
    document.addEventListener('click', (e) => {
      const sb = $('sidebar');
      if (!sb.classList.contains('open')) return;
      const inside = sb.contains(e.target) || $('btn_menu').contains(e.target);
      if (!inside) closeSidebar();
    });
  }

  /* ---------- Start ---------- */
  bind();
  setTabs('login');

  if (state.token){
    bootstrap().catch(() => showAuth('Session expired. Please login again.'));
  } else {
    showAuth('');
  }
})();
