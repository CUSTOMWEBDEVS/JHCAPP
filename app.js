/***********************
 * JHC HH Doc + Safety (Frontend)
 * GitHub Pages -> GAS JSON API
 ************************/

// >>> SET THIS <<<
const API_URL = "https://script.google.com/macros/s/AKfycbygg4PjGDYro9CKHRa6ZWqk9pdh5H8hzDEMfTERyqOsc8Gd-tOIPS42gEBaVQIRrC3z/exec"; // e.g. https://script.google.com/macros/s/AKfy.../exec

// state
let state = {
  token: localStorage.getItem("jhc_token") || "",
  me: null,
  patients: [],
  visits: [],
  activeVisitId: "",
  soc: {},
  autosaveTimer: null,

  rec: { mediaRecorder:null, chunks:[], blob:null, startedAt:null, endedAt:null }
};

const SOC_FIELDS = [
  // Header
  { k:"insurance", label:"Insurance *", cls:"full" },
  { k:"admit_date", label:"Admit date *", cls:"" },
  { k:"recent_hosp_related_to", label:"Recent hospitalization / related to *", cls:"" },
  { k:"homebound_due_phrase", label:"Homebound due to (exact phrase) *", cls:"full" },
  { k:"referred_by_dr", label:"Referred by DR. *", cls:"" },
  { k:"living_arrangements", label:"Living arrangements *", cls:"" },
  { k:"assist_with_adls", label:"Assist with ADLs *", cls:"" },

  // Core clinical fields (still needed by template)
  { k:"history", label:"History *", cls:"full" },
  { k:"plof", label:"Prior level of function", cls:"full" },
  { k:"fall_history", label:"History of falls", cls:"full" },

  { k:"rom", label:"ROM", cls:"" },
  { k:"strength", label:"Strength", cls:"" },
  { k:"endurance", label:"Endurance", cls:"" },
  { k:"sensation", label:"Sensation", cls:"" },
  { k:"transfers", label:"Transfers", cls:"" },
  { k:"gait", label:"Gait", cls:"" },
  { k:"tinetti", label:"Tinetti", cls:"" },
  { k:"balance", label:"Balance static standing", cls:"" },

  // Goal + Plan
  { k:"goal_quote", label:'GOAL: "___" *', cls:"full" },
  { k:"additional_comments", label:"Additional comments *", cls:"full" },
  { k:"plan_sentence", label:"PLAN (exact sentence if different)", cls:"full" },

  // Advance directive
  { k:"changed_meds", label:"Changed/Updated medications *", cls:"" },
  { k:"med_recon", label:"Performed medication reconciliation this date *", cls:"" },
  { k:"all_meds_present", label:"All medications present in home *", cls:"" },

  // Skilled obs + flags
  { k:"teaching_training_for", label:"Teaching and training for *", cls:"full" },
  { k:"vitals_within_parameters", label:"Vitals within parameters? *", cls:"" },
  { k:"who_notified", label:"Who notified (Case Manager/PCP) *", cls:"" },

  { k:"htn", label:"HTN *", cls:"" },
  { k:"copd", label:"COPD *", cls:"" },
  { k:"depression", label:"DEPRESSION *", cls:"" },
  { k:"dmii", label:"DMII *", cls:"" },
  { k:"chf", label:"CHF *", cls:"" },

  // Cardiovascular
  { k:"edema", label:"Edema", cls:"" },
  { k:"palpitations", label:"Palpitations", cls:"" },
  { k:"cardio_endurance", label:"Endurance", cls:"" },
  { k:"unable_to_weigh_due_to", label:"Unable to weigh due to", cls:"full" },
  { k:"right_measure_label", label:"RIGHT label", cls:"" },
  { k:"right_calf_cm", label:"RIGHT (ankle/calf) cm", cls:"" },
  { k:"left_measure_label", label:"LEFT label", cls:"" },
  { k:"left_calf_cm", label:"LEFT (ankle/calf) cm", cls:"" },

  // Respiratory / GI / Wound / Infection
  { k:"uses_supp_oxygen", label:"Uses supplemental oxygen (yes/no) *", cls:"" },
  { k:"oxygen_lpm", label:"Oxygen L/min", cls:"" },
  { k:"oxygen_route", label:"Route", cls:"" },
  { k:"nebulizer", label:"Nebulizer (yes/no) *", cls:"" },
  { k:"sob", label:"Short of Breath *", cls:"" },
  { k:"last_bm", label:"Last bowel movement *", cls:"" },
  { k:"appetite", label:"Appetite *", cls:"" },
  { k:"wound_statement", label:"WOUND statement *", cls:"full" },
  { k:"covid_symptoms_reported", label:"Covid symptoms reported (yes/no) *", cls:"" },
  { k:"covid_symptoms_detail_actions", label:"Symptoms detail/actions", cls:"full" },

  // Home safety + Emergency preparedness + PHQ2
  { k:"home_safety_teaching", label:"Home safety teaching (exact phrase) *", cls:"full" },
  { k:"home_safety_other", label:"Home safety other teaching", cls:"full" },
  { k:"family", label:"FAMILY *", cls:"" },
  { k:"with_person", label:"with ___ *", cls:"" },
  { k:"special_needs", label:"special needs of ___ *", cls:"full" },
  { k:"phq2_interest", label:"PHQ-2 interest answer *", cls:"" },
  { k:"phq2_depressed", label:"PHQ-2 depressed answer *", cls:"" },

  // HEP + MD/risks/goals
  { k:"hep_details", label:"HEP details *", cls:"full" },
  { k:"attending_md", label:"Attending MD *", cls:"" },
  { k:"primary_dx_focus", label:"Primary Dx / focus of care *", cls:"full" },
  { k:"rehospitalization_risks", label:"Re-hospitalization risks *", cls:"full" },
  { k:"anticipated_needs_future_visits", label:"Anticipated needs/education future visits *", cls:"full" },
  { k:"short_term_goals_weeks", label:"Short term goals weeks *", cls:"" },
  { k:"long_term_goals_weeks", label:"Long term goals weeks *", cls:"" },
  { k:"patient_identified_goal", label:"Patient identified goal *", cls:"full" },

  // Interventions (still referenced)
  { k:"gait_balance_training", label:"Gait/Balance training", cls:"full" },
  { k:"transfer_training", label:"Transfer training", cls:"full" },
  { k:"ther_ex", label:"Ther ex", cls:"full" },
  { k:"goals_progress", label:"Goals / progress", cls:"full" }
];

function $(id){ return document.getElementById(id); }
function val(id){ return $(id).value.trim(); }
function setVal(id,v){ $(id).value = v; }

function uiSetAuthTab(which){
  ["login","signup","reset"].forEach(k=>{
    $(`auth_${k}`).classList.toggle("hidden", k!==which);
    $(`tab_${k}`).classList.toggle("active", k===which);
  });
}

function setAuthVisible(show){
  $("auth_overlay").classList.toggle("hidden", !show);
  $("app_shell").classList.toggle("hidden", show);
}

function showPage(page){
  ["visits","patients","calendar","admin"].forEach(p=>{
    $(`page_${p}`).classList.toggle("hidden", p!==page);
    $(`nav_${p}`).classList.toggle("active", p===page);
  });
}

function apiLabel(){
  $("api_label").textContent = API_URL.includes("http") ? `API: ${API_URL}` : "API not set";
}

async function api(action, payload){
  if (!API_URL || API_URL.includes("PASTE_YOUR_GAS_EXEC_URL_HERE")) {
    throw new Error("Set API_URL in app.js to your GAS /exec URL.");
  }
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ action, payload, token: state.token })
  });
  const data = await res.json().catch(()=>({ ok:false, error:"Bad JSON response" }));
  if (!data.ok) throw new Error(data.error || "API error");
  return data;
}

/*** AUTH ***/
async function authSignup(){
  $("signup_msg").textContent = "";
  try{
    const email = val("signup_email");
    const password = val("signup_pass");
    const data = await api("auth.signup", { email, password });
    state.token = data.token;
    localStorage.setItem("jhc_token", state.token);
    await onAuthed(data.me);
  }catch(e){
    $("signup_msg").textContent = e.message;
  }
}

async function authLogin(){
  $("login_msg").textContent = "";
  try{
    const email = val("login_email");
    const password = val("login_pass");
    const data = await api("auth.login", { email, password });
    state.token = data.token;
    localStorage.setItem("jhc_token", state.token);
    await onAuthed(data.me);
  }catch(e){
    $("login_msg").textContent = e.message;
  }
}

async function authReset(){
  $("reset_msg").textContent = "";
  try{
    const email = val("reset_email");
    const data = await api("auth.reset", { email });
    if (data.method === "manual" && data.resetLink){
      $("reset_msg").innerHTML = `Email permission blocked. Copy reset link:<br><a href="${data.resetLink}" target="_blank" rel="noreferrer">${data.resetLink}</a>`;
    } else {
      $("reset_msg").textContent = "If that account exists, a reset email was sent.";
    }
  }catch(e){
    $("reset_msg").textContent = e.message;
  }
}

async function authResetConfirm(){
  $("reset2_msg").textContent = "";
  try{
    const reset_token = val("reset_token");
    const new_password = val("reset_newpass");
    await api("auth.resetConfirm", { reset_token, new_password });
    $("reset2_msg").textContent = "Password updated. Go login.";
    uiSetAuthTab("login");
  }catch(e){
    $("reset2_msg").textContent = e.message;
  }
}

function logout(){
  state.token = "";
  state.me = null;
  state.patients = [];
  state.visits = [];
  state.activeVisitId = "";
  state.soc = {};
  localStorage.removeItem("jhc_token");

  // CLEAR UI so nothing shows after logout
  $("visits_list").innerHTML = "";
  $("patients_list").innerHTML = "";
  $("calendar_list").innerHTML = "";
  $("admin_users").innerHTML = "";
  $("admin_patients").innerHTML = "";
  $("rendered_note").textContent = "";
  $("active_visit_id").value = "";
  $("soc_form").innerHTML = "";
  $("me_email").textContent = "—";
  $("me_role").textContent = "—";
  $("nav_admin").classList.add("hidden");

  setAuthVisible(true);
  uiSetAuthTab("login");
}

/*** BOOTSTRAP ***/
async function onAuthed(me){
  setAuthVisible(false);
  state.me = me;
  $("me_email").textContent = me.email;
  $("me_role").textContent = me.role;

  // Admin button visibility
  const isSupervisor = ["supervisor","admin"].includes(me.role);
  $("nav_admin").classList.toggle("hidden", !isSupervisor);

  showPage("visits");
  buildSocForm();
  await bootstrap();
}

async function bootstrap(){
  const data = await api("bootstrap", {});
  state.me = data.me;
  state.patients = data.patients || [];
  state.visits = data.visits || [];
  renderPatientsUI();
  renderVisitsUI();
  fillPatientSelects();
}

/*** PATIENTS ***/
function renderPatientsUI(){
  const list = $("patients_list");
  list.innerHTML = state.patients.map(p => `
    <div class="item">
      <div><b>${esc(p.last)}, ${esc(p.first)}</b> (${esc(p.patient_id)})</div>
      <div class="muted">${esc(p.address||"")}</div>
    </div>
  `).join("");
}

async function savePatient(){
  $("patient_save_msg").textContent = "";
  try{
    const payload = {
      first: val("p_first"),
      last: val("p_last"),
      dob: val("p_dob"),
      phone: val("p_phone"),
      address: val("p_address"),
      notes: val("p_notes"),
      active: "Y"
    };
    await api("patients.upsert", payload);
    $("patient_save_msg").textContent = "Saved.";
    await bootstrap();
  }catch(e){
    $("patient_save_msg").textContent = e.message;
  }
}

function fillPatientSelects(){
  const sel = $("visit_patient");
  sel.innerHTML = state.patients.map(p =>
    `<option value="${escAttr(p.patient_id)}">${esc(p.last)}, ${esc(p.first)} (${esc(p.patient_id)})</option>`
  ).join("");
}

/*** VISITS ***/
function renderVisitsUI(){
  const list = $("visits_list");
  if (!state.visits.length){
    list.innerHTML = `<div class="item"><div class="muted">No visits yet.</div></div>`;
    return;
  }
  list.innerHTML = state.visits.map(v => `
    <div class="item">
      <div><b>${esc(v.visit_id)}</b> — ${esc(v.visit_type)} — <span class="pill subtle">${esc(v.status)}</span></div>
      <div class="muted">${esc(v.patient_id)} • ${esc(v.scheduled_start||"")}</div>
      <div class="row">
        <button class="btn" onclick="openVisit('${escAttr(v.visit_id)}')">Open</button>
      </div>
    </div>
  `).join("");
}

async function createVisit(){
  $("visit_create_msg").textContent = "";
  try{
    const patient_id = $("visit_patient").value;
    const visit_type = $("visit_type").value;
    const scheduled_start = $("visit_start").value;
    const scheduled_end = $("visit_end").value;
    const share_calendar = $("visit_share").value;

    const data = await api("visits.create", { patient_id, visit_type, scheduled_start, scheduled_end, share_calendar });
    $("visit_create_msg").textContent = `Created ${data.visit_id}`;
    await bootstrap();
    await openVisit(data.visit_id);
  }catch(e){
    $("visit_create_msg").textContent = e.message;
  }
}

async function openVisit(visitId){
  state.activeVisitId = visitId;
  setVal("active_visit_id", visitId);
  await socLoad();
  await socGenerate(); // optional auto-generate
}

/*** SOC FORM ***/
function buildSocForm(){
  const wrap = $("soc_form");
  wrap.innerHTML = SOC_FIELDS.map(f => `
    <div class="${f.cls||""}">
      <label>${esc(f.label)}</label>
      ${f.cls==="full"
        ? `<textarea data-k="${escAttr(f.k)}" rows="2"></textarea>`
        : `<input data-k="${escAttr(f.k)}">`
      }
    </div>
  `).join("");

  // autosave 1s idle
  wrap.querySelectorAll("input,textarea").forEach(el=>{
    el.addEventListener("input", ()=>{
      if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
      state.autosaveTimer = setTimeout(()=>{ socSave(true).catch(()=>{}); }, 1000);
    });
  });
}

function socCollect(){
  const out = {};
  $("soc_form").querySelectorAll("[data-k]").forEach(el=>{
    out[el.getAttribute("data-k")] = el.value.trim();
  });
  return out;
}

function socFill(soc){
  $("soc_form").querySelectorAll("[data-k]").forEach(el=>{
    const k = el.getAttribute("data-k");
    el.value = (soc && soc[k]) ? String(soc[k]) : "";
  });
}

async function socLoad(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return;
  const data = await api("soc.get", { visit_id });
  state.soc = data.soc || {};
  socFill(state.soc);
  $("doc_msg").textContent = "Loaded SOC checklist.";
}

async function socSave(silent=false){
  const visit_id = val("active_visit_id");
  if (!visit_id) return;
  state.soc = socCollect();
  await api("soc.set", { visit_id, soc: state.soc });
  if (!silent) $("doc_msg").textContent = "Saved SOC checklist.";
}

async function socGenerate(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return;
  await socSave(true);
  const data = await api("note.render", { visit_id });
  $("rendered_note").textContent = data.note_text || "";
  $("doc_msg").textContent = "Generated.";
}

async function signLock(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return;
  if (!confirm("Sign & lock? No edits after this.")) return;
  await api("note.sign", { visit_id });
  $("doc_msg").textContent = "Signed & locked.";
  await bootstrap();
}

/*** CALENDAR ***/
async function loadCalendar(){
  const fromIso = val("cal_from") || null;
  const toIso = val("cal_to") || null;
  const data = await api("calendar.list", { fromIso, toIso });
  const rows = data.rows || [];
  $("calendar_list").innerHTML = rows.map(r => `
    <div class="item">
      <div><b>${esc(r.start||"")}</b> — ${esc(r.patient_label||"")}</div>
      <div class="muted">${esc(r.address||"(address hidden)")}</div>
      <div class="muted">${esc(r.clinician_email||"")} | visit: ${esc(r.visit_id||"")}</div>
    </div>
  `).join("");
}

/*** ADMIN ***/
async function adminLoadUsers(){
  const data = await api("admin.users.list", {});
  $("admin_users").innerHTML = (data.users||[]).map(u => `
    <div class="item">
      <div><b>${esc(u.email)}</b> <span class="pill">${esc(u.role)}</span> <span class="pill subtle">${esc(u.active)}</span></div>
      <div class="muted">last login: ${esc(u.last_login_at||"")}</div>
      <div class="row">
        <select id="role_${escAttr(u.email)}">
          <option ${u.role==="clinician"?"selected":""}>clinician</option>
          <option ${u.role==="supervisor"?"selected":""}>supervisor</option>
          <option ${u.role==="admin"?"selected":""}>admin</option>
        </select>
        <select id="active_${escAttr(u.email)}">
          <option value="Y" ${u.active==="Y"?"selected":""}>Y</option>
          <option value="N" ${u.active==="N"?"selected":""}>N</option>
        </select>
        <button class="btn" onclick="adminSetRole('${escAttr(u.email)}')">Save</button>
      </div>
    </div>
  `).join("");
}

async function adminSetRole(email){
  const role = $(`role_${email}`).value;
  const active = $(`active_${email}`).value;
  await api("admin.users.setRole", { email, role, active });
  await adminLoadUsers();
}

async function adminSearchPatients(){
  const q = val("admin_q");
  const data = await api("admin.patients.search", { q });
  $("admin_patients").innerHTML = (data.patients||[]).map(p => `
    <div class="item">
      <div><b>${esc(p.last)}, ${esc(p.first)}</b> (${esc(p.patient_id)})</div>
      <div class="muted">${esc(p.address||"")}</div>
    </div>
  `).join("");
}

/*** EMERGENCY ***/
async function triggerEmergency(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return alert("Open a visit first.");

  const location = await getLocationString().catch(()=> "");
  const type = prompt("Emergency type (fall, threat, medical):", "Emergency") || "Emergency";
  const severity = prompt("Severity (Low/Medium/High/Critical):", "High") || "High";
  const situation = prompt("Brief situation:", "") || "";

  const data = await api("incident.trigger", { visit_id, type, severity, situation, location });
  alert(`Emergency logged: ${data.incident_id}\nNotified: ${(data.notified||[]).join(", ") || "(none)"}`);

  // This is all the app can do:
  // it can open the phone dialer. It cannot place a call by itself.
  if (confirm("Call 911 now?")){
    window.location.href = "tel:911";
  }
}

function getLocationString(){
  return new Promise((resolve)=>{
    if (!navigator.geolocation) return resolve("");
    navigator.geolocation.getCurrentPosition(
      pos => resolve(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`),
      () => resolve(""),
      { enableHighAccuracy:true, timeout:8000 }
    );
  });
}

/*** RECORDING ***/
async function startRecording(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return alert("Open a visit first.");

  const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  const mime = pickMimeType();
  const mr = new MediaRecorder(stream, mime ? { mimeType:mime } : undefined);

  state.rec = { mediaRecorder: mr, chunks: [], blob:null, startedAt:new Date().toISOString(), endedAt:null };

  mr.ondataavailable = (e)=>{ if (e.data && e.data.size>0) state.rec.chunks.push(e.data); };
  mr.onstop = ()=>{
    state.rec.endedAt = new Date().toISOString();
    state.rec.blob = new Blob(state.rec.chunks, { type: mr.mimeType || "audio/webm" });
    $("rec_playback").src = URL.createObjectURL(state.rec.blob);
    $("rec_upload").disabled = false;
    $("rec_status").textContent = `Recorded ${Math.round(state.rec.blob.size/1024)} KB`;
  };

  mr.start();
  $("rec_start").disabled = true;
  $("rec_stop").disabled = false;
  $("rec_status").textContent = "Recording...";
}

function stopRecording(){
  const mr = state.rec.mediaRecorder;
  if (!mr) return;
  mr.stop();
  $("rec_start").disabled = false;
  $("rec_stop").disabled = true;
}

async function uploadRecording(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return alert("Open a visit first.");
  if (!state.rec.blob) return alert("No recording available.");

  $("rec_status").textContent = "Encoding...";
  const base64 = await blobToBase64(state.rec.blob);

  $("rec_status").textContent = "Uploading...";
  const retention_days = parseInt($("rec_retention").value, 10);

  const data = await api("recording.upload", {
    visit_id,
    filename: `rec_${visit_id}_${Date.now()}.webm`,
    mimeType: state.rec.blob.type || "audio/webm",
    base64,
    started_at: state.rec.startedAt,
    ended_at: state.rec.endedAt,
    retention_days
  });

  $("rec_status").innerHTML = `Uploaded: <a href="${data.drive_url}" target="_blank" rel="noreferrer">Open in Drive</a>`;
  $("rec_upload").disabled = true;
}

function pickMimeType(){
  const cands = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"];
  for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c;
  return "";
}
function blobToBase64(blob){
  return new Promise((resolve)=>{
    const r = new FileReader();
    r.onloadend = ()=> resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(blob);
  });
}

/*** ESCAPING ***/
function esc(s){
  return String(s||"")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function escAttr(s){ return String(s||"").replaceAll('"',"&quot;"); }

/*** STARTUP ***/
async function init(){
  apiLabel();

  if (state.token){
    try{
      const data = await api("bootstrap", {});
      await onAuthed(data.me);
      // bootstrap() already called in onAuthed; but we can use returned payload to avoid extra call:
      state.patients = data.patients || [];
      state.visits = data.visits || [];
      renderPatientsUI();
      renderVisitsUI();
      fillPatientSelects();
    }catch(e){
      // token invalid
      logout();
    }
  } else {
    setAuthVisible(true);
    uiSetAuthTab("login");
  }
}

init();
