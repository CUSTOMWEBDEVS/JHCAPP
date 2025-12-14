/***********************
 * CONFIG
 ***********************/
const API_URL = "https://script.google.com/macros/s/AKfycbzUpH8z5BpC9-Mz_8o0AjPMwcevM7fUqQ3-2rluCVLrOSdy7OBMfGRr-YKUnX6-EFdF/exec"; // <-- REPLACE with your /exec URL

/***********************
 * STATE
 ***********************/
let state = {
  token: "",
  me: null,
  patients: [],
  visits: [],
  selectedPatient: null,
  activeVisit: null,
  rec: { mediaRecorder: null, chunks: [], blob: null, startedAt: null, endedAt: null }
};

/***********************
 * DOM helpers
 ***********************/
const $ = (id) => document.getElementById(id);
function val(id){ return ($(id)?.value ?? "").trim(); }
function setVal(id,v){ if($(id)) $(id).value = v ?? ""; }
function setStatus(t){ $("statusLine").textContent = t; }
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

/***********************
 * Toast
 ***********************/
let toastTimer=null;
function toast(msg){
  const el = $("toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.style.display="none", 1800);
}

/***********************
 * API
 ***********************/
async function api(action, payload){
  if(!API_URL || API_URL.includes("PASTE_YOUR_GAS_EXEC_URL_HERE")){
    throw new Error("API URL not set in app.js");
  }
  const body = JSON.stringify({ action, token: state.token || "", payload: payload || {} });
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type":"text/plain;charset=utf-8" },
    body
  });

  // GAS returns 200 with JSON text; but if URL is wrong you’ll get 404/405 from GitHub
  if(!res.ok) throw new Error(`API HTTP ${res.status}`);

  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch(e){ throw new Error("Bad API response"); }
  if(!json.ok) throw new Error(json.error || "API error");
  return json.data;
}

/***********************
 * Auth tabs
 ***********************/
function uiAuthTab(which){
  $("tab_login").classList.toggle("active", which==="login");
  $("tab_signup").classList.toggle("active", which==="signup");
  $("tab_reset").classList.toggle("active", which==="reset");

  $("auth_login").style.display = which==="login" ? "block" : "none";
  $("auth_signup").style.display = which==="signup" ? "block" : "none";
  $("auth_reset").style.display = which==="reset" ? "block" : "none";

  $("login_msg").textContent = "";
  $("signup_msg").textContent = "";
  $("reset_msg").textContent = "";
}

/***********************
 * AUTH
 ***********************/
async function authSignup(){
  $("signup_msg").textContent = "";
  showLoading(true, "Creating account…");
  try{
    const email = val("signup_email");
    const password = val("signup_password");
    if(!email || !password) throw new Error("Enter email + password.");
    const data = await api("auth.signup", { email, password });
    $("signup_msg").textContent = "Account created. You can log in now.";
    uiAuthTab("login");
    setVal("login_email", email);
    toast("Account created");
  }catch(e){
    $("signup_msg").textContent = e.message;
  }finally{
    showLoading(false);
  }
}

async function authLogin(){
  $("login_msg").textContent = "";
  showLoading(true, "Logging in…");
  try{
    const email = val("login_email");
    const password = val("login_password");
    if(!email || !password) throw new Error("Enter email + password.");
    const data = await api("auth.login", { email, password });
    state.token = data.token;
    localStorage.setItem("hh_token", state.token);
    await bootstrap();
    toast("Logged in");
  }catch(e){
    $("login_msg").textContent = e.message;
  }finally{
    showLoading(false);
  }
}

async function authReset(){
  $("reset_msg").textContent = "";
  showLoading(true, "Sending reset email…");
  try{
    const email = val("reset_email");
    if(!email) throw new Error("Enter email.");
    await api("auth.reset", { email });
    $("reset_msg").textContent = "If that account exists, a reset email was sent.";
    toast("Reset sent");
  }catch(e){
    $("reset_msg").textContent = e.message;
  }finally{
    showLoading(false);
  }
}

/***********************
 * Logout / clear
 ***********************/
function clearAppUI(){
  if ($("me_email")) $("me_email").textContent = "";
  if ($("me_role")) $("me_role").textContent = "";
  if ($("nav_admin")) $("nav_admin").style.display = "none";

  if ($("dash_recent")) $("dash_recent").innerHTML = "";

  if ($("patient_select")) $("patient_select").innerHTML = `<option value="">Select…</option>`;
  if ($("visit_patient")) $("visit_patient").innerHTML = `<option value="">Select…</option>`;
  if ($("patient_detail")) $("patient_detail").textContent = "";

  ["p_first","p_last","p_dob","p_phone","p_address","p_notes"].forEach(id=>setVal(id,""));
  if ($("patient_save_msg")) $("patient_save_msg").textContent = "";

  ["visit_type","v_start","v_end","active_visit_id"].forEach(id=>setVal(id,""));
  if ($("visit_create_msg")) $("visit_create_msg").textContent = "";
  if ($("visits_list")) $("visits_list").innerHTML = "";

  [
    "f_subjective","f_homebound","f_referred_by","f_living","f_history","f_plof","f_falls",
    "f_rom","f_strength","f_endurance","f_sensation","f_transfers","f_gait","f_balance","f_tinetti",
    "f_vitals","f_disease_mgmt","f_precautions","f_home_safety","f_phq2",
    "f_gait_training","f_transfer_training","f_therex","f_goal_progress"
  ].forEach(id=>setVal(id,""));

  if ($("rendered_note")) $("rendered_note").textContent = "";
  if ($("doc_msg")) $("doc_msg").textContent = "";

  setVal("cal_from","");
  setVal("cal_to","");
  if ($("calendar_list")) $("calendar_list").innerHTML = "";

  setVal("admin_user_email","");
  setVal("admin_user_role","clinician");
  setVal("admin_user_active","Y");
  setVal("admin_patient_q","");
  if ($("admin_users_list")) $("admin_users_list").innerHTML = "";
  if ($("admin_patients_list")) $("admin_patients_list").innerHTML = "";

  if ($("checklist_wrap")) $("checklist_wrap").innerHTML = "";
  state.activeVisit = null;

  $("rec_status").textContent = "Not recording.";
  $("rec_playback").src = "";
  $("rec_upload").disabled = true;
  $("rec_stop").disabled = true;
  $("rec_start").disabled = false;

  setStatus("Idle");
}

function logout(){
  state.token = "";
  state.me = null;
  state.patients = [];
  state.visits = [];
  state.selectedPatient = null;
  state.activeVisit = null;

  localStorage.removeItem("hh_token");
  clearAppUI();

  $("view_app").style.display = "none";
  $("view_auth").style.display = "grid";
  showLoading(false);
  uiAuthTab("login");
  toast("Logged out");
}

/***********************
 * Nav
 ***********************/
function navTo(page){
  ["dash","patients","visits","calendar","admin"].forEach(p=>{
    $(`page_${p}`).style.display = (p===page) ? "block" : "none";
    $(`nav_${p}`).classList.toggle("active", p===page);
  });
}

/***********************
 * Loading
 ***********************/
function showLoading(on, text){
  if(on){
    $("loading").style.display = "flex";
    if(text) $("loading").querySelector(".loadingText").textContent = text;
  }else{
    $("loading").style.display = "none";
  }
}

/***********************
 * Bootstrap (fast)
 ***********************/
async function bootstrap(){
  showLoading(true, "Loading workspace…");
  try{
    const data = await api("app.bootstrap", {});
    state.me = data.me;
    state.patients = data.patients || [];
    state.visits = data.visits || [];

    // Header
    $("me_email").textContent = state.me.email;
    $("me_role").textContent = state.me.role;

    // Admin visibility
    if(state.me.role === "admin" || state.me.role === "supervisor"){
      $("nav_admin").style.display = "block";
    } else {
      $("nav_admin").style.display = "none";
    }

    // Populate selects
    renderPatientsSelects();
    renderVisits();
    renderDashboardRecent();

    // Show app
    $("view_auth").style.display = "none";
    $("view_app").style.display = "block";
    navTo("dash");
    toast("Ready");
  }finally{
    showLoading(false);
  }
}

function renderDashboardRecent(){
  const top = (state.visits || []).slice(0, 6);
  $("dash_recent").innerHTML = top.map(v=>`
    <div class="item">
      <div><b>${escapeHtml(v.visit_id)}</b> — ${escapeHtml(v.visit_type)} — ${escapeHtml(v.status)}</div>
      <div class="muted">${escapeHtml(v.patient_label || v.patient_id)} • ${escapeHtml(v.scheduled_start || "")}</div>
      <div class="row">
        <button class="btn" onclick="useVisit('${v.visit_id}')">Open</button>
      </div>
    </div>
  `).join("") || `<div class="muted">No visits yet.</div>`;
}

/***********************
 * Patients
 ***********************/
function renderPatientsSelects(){
  const opts = [`<option value="">Select…</option>`].concat(
    state.patients.map(p=> `<option value="${p.patient_id}">${escapeHtml(p.last)}, ${escapeHtml(p.first)} (${p.patient_id})</option>`)
  ).join("");

  $("patient_select").innerHTML = opts;
  $("visit_patient").innerHTML = opts;
}

function selectPatient(pid){
  state.selectedPatient = state.patients.find(p=>p.patient_id===pid) || null;
  $("patient_detail").textContent = state.selectedPatient
    ? `${state.selectedPatient.first} ${state.selectedPatient.last} • ${state.selectedPatient.address || ""}`
    : "";
  if(state.selectedPatient){
    setVal("p_first", state.selectedPatient.first || "");
    setVal("p_last", state.selectedPatient.last || "");
    setVal("p_dob", state.selectedPatient.dob || "");
    setVal("p_phone", state.selectedPatient.phone || "");
    setVal("p_address", state.selectedPatient.address || "");
    setVal("p_notes", state.selectedPatient.notes || "");
  }
}

async function savePatient(){
  $("patient_save_msg").textContent = "";
  showLoading(true, "Saving patient…");
  try{
    const payload = {
      patient_id: state.selectedPatient?.patient_id || "",
      first: val("p_first"),
      last: val("p_last"),
      dob: val("p_dob"),
      phone: val("p_phone"),
      address: val("p_address"),
      notes: val("p_notes"),
      active: "Y"
    };
    const data = await api("patients.upsert", payload);
    state.patients = data.patients;
    renderPatientsSelects();
    $("patient_select").value = data.patient_id;
    selectPatient(data.patient_id);
    $("patient_save_msg").textContent = `Saved ${data.patient_id}`;
    toast("Patient saved");
  }catch(e){
    $("patient_save_msg").textContent = e.message;
  }finally{
    showLoading(false);
  }
}

/***********************
 * Visits
 ***********************/
function renderVisits(){
  $("visits_list").innerHTML = (state.visits || []).map(v=>`
    <div class="item">
      <div><b>${escapeHtml(v.visit_id)}</b> — ${escapeHtml(v.visit_type)} — ${escapeHtml(v.status)}</div>
      <div class="muted">${escapeHtml(v.patient_label || v.patient_id)} • ${escapeHtml(v.scheduled_start || "")}</div>
      <div class="row">
        <button class="btn" onclick="useVisit('${v.visit_id}')">Open</button>
      </div>
    </div>
  `).join("") || `<div class="muted">No visits yet.</div>`;
}

async function createVisit(){
  $("visit_create_msg").textContent = "";
  showLoading(true, "Creating visit…");
  try{
    const patient_id = val("visit_patient");
    if(!patient_id) throw new Error("Select a patient.");
    const payload = {
      patient_id,
      visit_type: val("visit_type"),
      scheduled_start: val("v_start"),
      scheduled_end: val("v_end"),
      share_team: val("visit_share") || "Y"
    };
    const data = await api("visits.create", payload);
    state.visits = data.visits;
    renderVisits();
    renderDashboardRecent();
    setVal("active_visit_id", data.visit_id);
    await useVisit(data.visit_id);
    $("visit_create_msg").textContent = `Created ${data.visit_id}`;
    toast("Visit created");
  }catch(e){
    $("visit_create_msg").textContent = e.message;
  }finally{
    showLoading(false);
  }
}

async function useVisit(visit_id){
  if(!visit_id) return;
  setVal("active_visit_id", visit_id);

  showLoading(true, "Loading visit…");
  try{
    const data = await api("visits.get", { visit_id });
    state.activeVisit = data.visit;

    // Fill clinical fields
    fillClinicalFields(state.activeVisit.fields || {});

    // Build checklist UI (SOC/INITIAL only)
    buildChecklist(state.activeVisit.visit_type, state.activeVisit.checklist || {});
    $("rendered_note").textContent = state.activeVisit.rendered_note || "";

    // Also select patient in UI
    if(state.activeVisit.patient_id){
      $("patient_select").value = state.activeVisit.patient_id;
      selectPatient(state.activeVisit.patient_id);
      $("visit_patient").value = state.activeVisit.patient_id;
    }

    // lock state
    if(state.activeVisit.status === "SIGNED"){
      $("doc_msg").textContent = "Signed & locked (read-only).";
    }else{
      $("doc_msg").textContent = "";
    }

    navTo("visits");
    toast("Visit loaded");
  }finally{
    showLoading(false);
  }
}

async function loadActive(){
  const vid = val("active_visit_id");
  if(!vid) return alert("Enter a visit ID.");
  await useVisit(vid);
}

/***********************
 * Clinical fields
 ***********************/
function collectClinicalFields(){
  return {
    subjective: val("f_subjective"),
    homebound: val("f_homebound"),
    referred_by: val("f_referred_by"),
    living: val("f_living"),
    history: val("f_history"),
    plof: val("f_plof"),
    falls: val("f_falls"),

    rom: val("f_rom"),
    strength: val("f_strength"),
    endurance: val("f_endurance"),
    sensation: val("f_sensation"),
    transfers: val("f_transfers"),
    gait: val("f_gait"),
    balance: val("f_balance"),
    tinetti: val("f_tinetti"),

    vitals: val("f_vitals"),
    disease_mgmt: val("f_disease_mgmt"),
    precautions: val("f_precautions"),
    home_safety: val("f_home_safety"),
    phq2: val("f_phq2"),

    gait_training: val("f_gait_training"),
    transfer_training: val("f_transfer_training"),
    therex: val("f_therex"),

    goal_progress: val("f_goal_progress"),
  };
}

function fillClinicalFields(f){
  setVal("f_subjective", f.subjective || "");
  setVal("f_homebound", f.homebound || "");
  setVal("f_referred_by", f.referred_by || "");
  setVal("f_living", f.living || "");
  setVal("f_history", f.history || "");
  setVal("f_plof", f.plof || "");
  setVal("f_falls", f.falls || "");

  setVal("f_rom", f.rom || "");
  setVal("f_strength", f.strength || "");
  setVal("f_endurance", f.endurance || "");
  setVal("f_sensation", f.sensation || "");
  setVal("f_transfers", f.transfers || "");
  setVal("f_gait", f.gait || "");
  setVal("f_balance", f.balance || "");
  setVal("f_tinetti", f.tinetti || "");

  setVal("f_vitals", f.vitals || "");
  setVal("f_disease_mgmt", f.disease_mgmt || "");
  setVal("f_precautions", f.precautions || "");
  setVal("f_home_safety", f.home_safety || "");
  setVal("f_phq2", f.phq2 || "");

  setVal("f_gait_training", f.gait_training || "");
  setVal("f_transfer_training", f.transfer_training || "");
  setVal("f_therex", f.therex || "");

  setVal("f_goal_progress", f.goal_progress || "");
}

async function saveAll(){
  const visit_id = val("active_visit_id");
  if(!visit_id) return alert("Enter a visit ID.");
  showLoading(true, "Saving…");
  try{
    const fields = collectClinicalFields();
    const checklist = readChecklist();
    const data = await api("visits.save", { visit_id, fields, checklist });
    state.activeVisit = data.visit;
    $("doc_msg").textContent = "Saved.";
    toast("Saved");
  }catch(e){
    $("doc_msg").textContent = e.message;
  }finally{
    showLoading(false);
  }
}

/***********************
 * Checklist UI (SOC + INITIAL)
 ***********************/
const CHECKLIST_SCHEMAS = {
  SOC: [
    group("Header", [
      t("insurance","Insurance",true),
    ]),
    group("SOC subjective tokens", [
      t("admit_date","Admit date",true,"date"),
      t("recent_hosp","Recent hospitalization / related to",true),
      t("homebound_due_to","Homebound due to (exact phrase)",true),
      t("referring_md","Referred by DR.",true),
      s("adl_assist","Assist with ADLs",true,["Independent","Supervision","Min","Mod","Max","Dependent"]),
    ]),
    group("Goal + Plan", [
      t("goal_quote",'GOAL: "___"',true),
      t("additional_comments","ADDITIONAL COMMENTS",true),
      ta("plan_text","PLAN (exact sentence if different)",false),
    ]),
    group("Advance Directive/POA", [
      yn("ad_instructed","Patient/caregiver instructed/educated",true),
      yn("ad_provided","Forms provided and reviewed",true),
      yn("ad_left","Forms left in home",true),
    ]),
    group("Medication Safety", [
      t("med_changes","Changed/Updated medications",true),
      t("medrec_done","Performed medication reconciliation this date",true),
      t("all_meds_present","All medications present in home",true),
    ]),
    group("Skilled Obs + Dx flags", [
      t("teaching_training_for","Teaching and training for",true),
      t("vitals_within_params","Vitals within parameters?",true),
      t("provider_notified","Who notified (Case Manager/PCP)",true),
      yn("dx_htn","HTN",true),
      yn("dx_copd","COPD",true),
      yn("dx_dep","DEPRESSION",true),
      yn("dx_dm2","DMII",true),
      yn("dx_chf","CHF",true),
    ]),
    group("Cardiovascular", [
      t("edema","Edema",true),
      t("palpitations","Palpitations",true),
      t("cardio_endurance","Endurance",true),
      t("unable_to_weigh","Unable to weigh due to",true),
      t("alt_measure_right","RIGHT (ankle/calf) cm",true),
      t("alt_measure_left","LEFT (ankle/calf) cm",true),
    ]),
    group("Resp / GI / Wound / Infection", [
      s("o2_use","Uses supplemental oxygen",true,["yes","no"]),
      t("o2_lpm","Oxygen L/min",false),
      t("o2_route","Route (nasal cannula)",false),
      s("nebulizer","Nebulizer",true,["yes","no"]),
      t("sob_with","Short of Breath",true),
      t("last_bm","Last bowel movement",true),
      t("appetite","Appetite",true),
      t("wound","WOUND statement",true),
      s("covid_symptoms_yesno","Covid symptoms reported",true,["yes","no"]),
      t("covid_symptoms_detail","Symptoms detail/actions",false),
    ]),
    group("Home safety + Emergency preparedness + PHQ-2", [
      ta("home_safety_text","Home safety teaching (exact phrase)",true),
      t("evac_family","FAMILY",true),
      t("evac_with","with ___",true),
      t("special_needs","special needs of ___",true),
      t("phq2_interest","PHQ-2 interest answer",true),
      t("phq2_down","PHQ-2 depressed answer",true),
    ]),
    group("HEP + MD/risks/goals", [
      t("hep_details","HEP details",true),
      t("attending_md","Attending MD",true),
      t("primary_focus","Primary Dx / focus of care",true),
      t("rehosp_risks","Re-hospitalization risks",true),
      t("anticipated_needs","Anticipated needs/education future visits",true),
      t("stg_weeks","Short term goals weeks",true),
      t("ltg_weeks","Long term goals weeks",true),
      t("patient_identified_goal","Patient identified goal",true),
    ]),
  ],
  INITIAL: [
    group("Initial subjective tokens", [
      t("hospital_stay","Hospital stay (exact)",true),
      t("referring_md","Referred by DR.",true),
      t("lives_with","Lives with ___",true),
      t("adl_assist","Requires ___ assist with ADLs",true),
      t("rooms_level","Rooms on ___ level + ___ accessible",true),
      t("steps_enter","Steps to enter/exit home",true),
      t("emergency_plan","Emergency plan: stay with ___",true),
      t("falls_text","History of falls (exact)",true),
    ]),
    group("Plan + comments", [
      t("additional_comments","ADDITIONAL COMMENTS",true),
    ]),
    group("Medication + dx + cardio + resp/GI/wound/infection", [
      t("med_changes","Changed/Updated medications",true),
      t("medrec_done","Performed Medication reconciliation (NO/YES)",true),
      t("all_meds_present","All Medications present (YES/NO)",true),
      t("vitals_within_params","Vitals within parameters?",true),
      t("provider_notified","Who notified",true),
      t("disease_mgmt_related","Disease mgmt teaching/training related to",true),
      yn("dx_htn","HTN",true),
      yn("dx_copd","COPD",true),
      yn("dx_dep","DEPRESSION",true),
      yn("dx_dm2","DMII",true),
      yn("dx_chf","CHF",true),
      t("edema","Edema",true),
      t("palpitations","Palpitations",true),
      t("cardio_endurance","Endurance",true),
      t("unable_to_weigh","Unable to weigh due to",true),
      t("alt_measure_right","RIGHT cm",true),
      t("alt_measure_left","LEFT cm",true),
      t("precautions","Special instructions/precautions",true),
      s("o2_use","Uses supplemental oxygen",true,["NO","YES"]),
      t("o2_lpm","Oxygen L/min",false),
      s("nebulizer","Nebulizer",true,["NO","YES"]),
      t("sob_with","Short of breath with",true),
      t("last_bm","Last bowel movement",true),
      t("appetite","Appetite",true),
      t("wound","WOUND statement",true),
      s("covid_symptoms_yesno","Symptoms reported",true,["yes","no"]),
      t("covid_symptoms_detail","Symptoms detail/actions",false),
      t("home_safety_text","Home safety/fall prevention",true),
      t("phq2_interest","PHQ-2 interest answer",true),
      t("phq2_down","PHQ-2 depressed answer",true),
      t("hep_details","HEP details",true),
      t("goal_progress","Progress toward goals text",true),
    ]),
  ]
};

function group(title, fields){ return { title, fields }; }
function t(key,label,required,type="text"){ return { key,label,required,type }; }
function ta(key,label,required){ return { key,label,required,type:"textarea" }; }
function s(key,label,required,options){ return { key,label,required,type:"select",options }; }
function yn(key,label,required){ return { key,label,required,type:"select",options:["YES","NO"] }; }

function buildChecklist(visitType, existing){
  const wrap = $("checklist_wrap");
  wrap.innerHTML = "";

  const schema = (visitType === "SOC") ? CHECKLIST_SCHEMAS.SOC
               : (visitType === "INITIAL") ? CHECKLIST_SCHEMAS.INITIAL
               : null;

  if(!schema){
    wrap.innerHTML = `<div class="muted">Checklist not required for this visit type yet.</div>`;
    return;
  }

  schema.forEach(g=>{
    const gEl = document.createElement("div");
    gEl.className = "ckGroup";
    gEl.innerHTML = `<div class="ckTitle">${escapeHtml(g.title)}</div>`;
    wrap.appendChild(gEl);

    const row = document.createElement("div");
    row.className = "ckRow";
    gEl.appendChild(row);

    g.fields.forEach(f=>{
      const id = `ck_${f.key}`;
      const cell = document.createElement("div");
      cell.innerHTML = `<label>${escapeHtml(f.label)}${f.required ? " *" : ""}</label>`;
      let input = null;

      if(f.type === "select"){
        input = document.createElement("select");
        input.id = id;
        input.innerHTML = f.options.map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
      }else if(f.type === "textarea"){
        input = document.createElement("textarea");
        input.id = id;
        input.rows = 2;
      }else{
        input = document.createElement("input");
        input.id = id;
        input.type = f.type || "text";
      }

      cell.appendChild(input);
      row.appendChild(cell);

      // populate existing
      const v = existing?.[f.key];
      if(v !== undefined && v !== null) input.value = v;
    });
  });
}

function readChecklist(){
  const visitType = state.activeVisit?.visit_type;
  const schema = (visitType === "SOC") ? CHECKLIST_SCHEMAS.SOC
               : (visitType === "INITIAL") ? CHECKLIST_SCHEMAS.INITIAL
               : null;
  if(!schema) return {};

  const out = {};
  for(const g of schema){
    for(const f of g.fields){
      const el = $(`ck_${f.key}`);
      if(!el) continue;
      out[f.key] = (el.value ?? "").trim();
    }
  }
  return out;
}

function toggleChecklist(){
  const el = $("checklist_wrap");
  el.style.display = (el.style.display === "none") ? "block" : "none";
}

/***********************
 * Render + sign
 ***********************/
async function renderNote(){
  const visit_id = val("active_visit_id");
  if(!visit_id) return alert("Enter a visit ID.");

  showLoading(true, "Generating note…");
  try{
    // save first
    const fields = collectClinicalFields();
    const checklist = readChecklist();
    const data = await api("visits.render", { visit_id, fields, checklist });
    state.activeVisit = data.visit;
    $("rendered_note").textContent = state.activeVisit.rendered_note || "";
    $("doc_msg").textContent = "Generated.";
    toast("Generated");
  }catch(e){
    $("doc_msg").textContent = e.message;
  }finally{
    showLoading(false);
  }
}

async function signAndLock(){
  const visit_id = val("active_visit_id");
  if(!visit_id) return alert("Enter a visit ID.");
  if(!confirm("Sign & lock? No edits after this.")) return;

  showLoading(true, "Signing…");
  try{
    const data = await api("visits.sign", { visit_id });
    state.activeVisit = data.visit;
    $("rendered_note").textContent = state.activeVisit.rendered_note || "";
    $("doc_msg").textContent = "Signed & locked.";
    toast("Signed");
  }catch(e){
    $("doc_msg").textContent = e.message;
  }finally{
    showLoading(false);
  }
}

/***********************
 * Calendar
 ***********************/
async function loadCalendar(){
  showLoading(true, "Loading calendar…");
  try{
    const fromIso = val("cal_from") || null;
    const toIso = val("cal_to") || null;
    const data = await api("calendar.list", { fromIso, toIso });
    $("calendar_list").innerHTML = (data.rows || []).map(r=>`
      <div class="item">
        <div><b>${escapeHtml(r.start || "")}</b> — ${escapeHtml(r.patient_label || "")}</div>
        <div class="muted">${escapeHtml(r.address || "(address hidden)")}</div>
        <div class="muted">${escapeHtml(r.clinician_email || "")} • ${escapeHtml(r.visit_id || "")}</div>
      </div>
    `).join("") || `<div class="muted">No items.</div>`;
  }finally{
    showLoading(false);
  }
}

/***********************
 * Emergency
 ***********************/
async function triggerEmergency(){
  const visit_id = val("active_visit_id");
  if(!visit_id) return alert("Set an active Visit ID first.");

  const location = await getLocationString().catch(()=> "");
  const type = prompt("Emergency type (fall, threat, medical):", "Emergency") || "Emergency";
  const severity = prompt("Severity (Low/Medium/High/Critical):", "High") || "High";
  const situation = prompt("Brief situation:", "") || "";

  showLoading(true, "Logging emergency…");
  try{
    const data = await api("incidents.create", { visit_id, type, severity, situation, location });
    alert(`Emergency logged: ${data.incident_id}\nNotified: ${(data.notified || []).join(", ") || "(none)"}`);
    if(confirm("Call 911 now?")){
      window.location.href = "tel:911";
    }
  }catch(e){
    alert(e.message);
  }finally{
    showLoading(false);
  }
}

function getLocationString(){
  return new Promise((resolve)=>{
    if(!navigator.geolocation) return resolve("");
    navigator.geolocation.getCurrentPosition(
      pos => resolve(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`),
      () => resolve(""),
      { enableHighAccuracy:true, timeout:8000 }
    );
  });
}

/***********************
 * Admin
 ***********************/
async function adminListUsers(){
  showLoading(true, "Loading users…");
  try{
    const data = await api("admin.users.list", {});
    $("admin_users_list").innerHTML = (data.users || []).map(u=>`
      <div class="item">
        <div><b>${escapeHtml(u.email)}</b> — ${escapeHtml(u.role)} — active: ${escapeHtml(u.active)}</div>
      </div>
    `).join("") || `<div class="muted">No users.</div>`;
  }finally{ showLoading(false); }
}

async function adminUpsertUser(){
  showLoading(true, "Saving user…");
  try{
    const payload = {
      email: val("admin_user_email"),
      role: val("admin_user_role"),
      active: val("admin_user_active"),
    };
    const data = await api("admin.users.upsert", payload);
    toast("User saved");
    await adminListUsers();
  }catch(e){
    alert(e.message);
  }finally{ showLoading(false); }
}

async function adminFindPatients(){
  showLoading(true, "Searching…");
  try{
    const q = val("admin_patient_q");
    const data = await api("admin.patients.search", { q });
    $("admin_patients_list").innerHTML = (data.patients || []).map(p=>`
      <div class="item">
        <div><b>${escapeHtml(p.patient_id)}</b> — ${escapeHtml(p.last)}, ${escapeHtml(p.first)}</div>
        <div class="muted">${escapeHtml(p.address || "")}</div>
        <div class="muted">DOB: ${escapeHtml(p.dob || "")} • Phone: ${escapeHtml(p.phone || "")}</div>
      </div>
    `).join("") || `<div class="muted">No results.</div>`;
  }finally{ showLoading(false); }
}

/***********************
 * Recording
 ***********************/
async function startRecording(){
  const visit_id = val("active_visit_id");
  if(!visit_id) return alert("Set an active Visit ID first.");

  const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  const mime = pickMimeType();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

  state.rec = { mediaRecorder: mr, chunks: [], blob: null, startedAt: new Date().toISOString(), endedAt: null };

  mr.ondataavailable = (e)=>{ if(e.data && e.data.size>0) state.rec.chunks.push(e.data); };
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
  $("rec_status").textContent = "Recording…";
}

function stopRecording(){
  const mr = state.rec.mediaRecorder;
  if(!mr) return;
  mr.stop();
  $("rec_start").disabled = false;
  $("rec_stop").disabled = true;
}

async function uploadRecording(){
  const visit_id = val("active_visit_id");
  if(!visit_id) return alert("Set an active Visit ID first.");
  if(!state.rec.blob) return alert("No recording available.");

  $("rec_status").textContent = "Encoding…";
  const base64 = await blobToBase64(state.rec.blob);

  $("rec_status").textContent = "Uploading…";
  const retention_days = parseInt(val("rec_retention") || "30", 10);

  showLoading(true, "Uploading audio…");
  try{
    const data = await api("recordings.upload", {
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
    toast("Uploaded");
  }finally{
    showLoading(false);
  }
}

function pickMimeType(){
  const candidates = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"];
  for(const c of candidates) if(MediaRecorder.isTypeSupported(c)) return c;
  return "";
}
function blobToBase64(blob){
  return new Promise((resolve)=>{
    const r = new FileReader();
    r.onloadend = ()=> resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(blob);
  });
}

/***********************
 * Startup
 ***********************/
(async function init(){
  clearAppUI();
  uiAuthTab("login");

  // Auto-login if token exists
  const tok = localStorage.getItem("hh_token") || "";
  if(tok){
    state.token = tok;
    showLoading(true, "Restoring session…");
    try{
      await bootstrap();
    }catch(e){
      // token bad, force auth
      state.token = "";
      localStorage.removeItem("hh_token");
      $("view_app").style.display = "none";
      $("view_auth").style.display = "grid";
    }finally{
      showLoading(false);
    }
  }
})();
