/**************** CONFIG ****************/
const GAS_URL = "https://script.google.com/macros/s/AKfycbxg5i_x1rnU2CI6eYNimH43vnygqHsjhvaR2UM1AI03f2s2MVTdvNn-p8yBPM1XVGSP/exec";

/**************** STATE ****************/
const state = {
  token: localStorage.getItem("hh_token") || "",
  me: null,
  patients: [],
  selectedPatient: null,
  visits: [],
  autosaveTimer: null,
  autosaveDirty: false,
  adminPatientTimer: null,
};


/**************** HELPERS ****************/
const $ = (id) => document.getElementById(id);
const val = (id) => String($(id)?.value || "").trim();
const setVal = (id, v) => { if ($(id)) $(id).value = v ?? ""; };

function toast(msg){
  const host = $("toast");
  const el = document.createElement("div");
  el.className = "t";
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(6px)"; }, 2500);
  setTimeout(()=>{ el.remove(); }, 3200);
}

function setStatus(t){ $("statusBadge").textContent = t; }

async function api(action, data = {}) {
  setStatus("Working…");
  const body = JSON.stringify({ action, data, token: state.token });

  // Use text/plain to reduce CORS preflight headaches in some setups
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body
  });

  const json = await res.json().catch(() => null);
  setStatus("Idle");

  if (!json || !json.ok) {
    const err = json?.error || "API error";
    toast(err);
    throw new Error(err);
  }
  return json.data;
}

function uiShowAuth(which){
  $("tab_login").classList.toggle("active", which === "login");
  $("tab_signup").classList.toggle("active", which === "signup");
  $("pane_login").style.display = which === "login" ? "block" : "none";
  $("pane_signup").style.display = which === "signup" ? "block" : "none";
}

function showTab(name){
  const tabs = ["patients","visits","doc","safety","calendar","admin"];
  tabs.forEach(t=>{
    const tabEl = $(`tab_${t}`);
    const navEl = $(`nav_${t}`);
    if (tabEl) tabEl.style.display = (t === name) ? "block" : "none";
    if (navEl) navEl.classList.toggle("active", t === name);
  });
}

/**************** AUTH ****************/
async function authSignup(){
  $("signup_msg").textContent = "";
  const email = val("signup_email");
  const password = val("signup_password");
  const res = await api("signup", { email, password });
  $("signup_msg").textContent = res.message || "Done.";
  toast(res.message || "Done");
}

async function authLogin(){
  $("login_msg").textContent = "";
  const email = val("login_email");
  const password = val("login_password");
  const res = await api("login", { email, password });
  state.token = res.token;
  localStorage.setItem("hh_token", state.token);
  await boot();
}

function logout(){
  state.token = "";
  state.me = null;
  localStorage.removeItem("hh_token");
  $("view_app").style.display = "none";
  $("view_auth").style.display = "grid";
  toast("Logged out");
}

/**************** BOOT ****************/
async function boot(){
  if (!state.token) {
    $("view_auth").style.display = "grid";
    $("view_app").style.display = "none";
    return;
  }

  try {
    state.me = await api("me", {});
  } catch (e) {
    logout();
    return;
  }

  $("me_email").textContent = state.me.email;
  $("me_role").textContent = state.me.role;

  // gate admin tab
  const isPriv = ["admin","supervisor"].includes(state.me.role);
  $("nav_admin").style.display = isPriv ? "block" : "none";

  $("view_auth").style.display = "none";
  $("view_app").style.display = "grid";

  wireAutosave();
  await reloadAll();
}

async function reloadAll(){
  await loadPatients();
  await loadVisits();
}

/**************** PATIENTS ****************/
async function loadPatients(){
  const patients = await api("listPatients", {});
  state.patients = patients;

  $("patient_select").innerHTML =
    `<option value="">Select…</option>` +
    patients.map(p => `<option value="${p.patient_id}">${esc(p.last)}, ${esc(p.first)} (${p.patient_id})</option>`).join("");

  toast(`Loaded ${patients.length} patients`);
}

function selectPatient(pid){
  state.selectedPatient = state.patients.find(p => p.patient_id === pid) || null;
  const p = state.selectedPatient;

  $("patient_detail").textContent = p ? `${p.first} ${p.last} • ${p.address || ""}` : "";
  if (p){
    setVal("p_first", p.first);
    setVal("p_last", p.last);
    setVal("p_dob", p.dob);
    setVal("p_phone", p.phone);
    setVal("p_address", p.address);
    setVal("p_notes", p.notes);
  }
}

async function savePatient(){
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
  const res = await api("upsertPatient", payload);
  $("patient_save_msg").textContent = `Saved ${res.patient_id}`;
  toast(`Patient saved: ${res.patient_id}`);
  await loadPatients();
  $("patient_select").value = res.patient_id;
  selectPatient(res.patient_id);
}

/**************** VISITS ****************/
async function loadVisits(){
  const visits = await api("listVisits", { limit: 50 });
  state.visits = visits;

  $("visits_list").innerHTML = visits.map(v => `
    <div class="item">
      <div>
        <div class="t">${esc(v.visit_type)} <span class="badge">${esc(v.status)}</span></div>
        <div class="m"><b>${esc(v.visit_id)}</b> • patient ${esc(v.patient_id)} • ${esc(v.scheduled_start || "")}</div>
      </div>
      <div class="row" style="flex:0 0 auto">
        <button class="btn good" onclick="useVisit('${v.visit_id}')">Open</button>
      </div>
    </div>
  `).join("");

  toast(`Loaded ${visits.length} visits`);
}

async function createVisit(){
  const pid = val("patient_select");
  if (!pid) return toast("Pick a patient first");

  const res = await api("createVisit", {
    patient_id: pid,
    visit_type: val("visit_type"),
    scheduled_start: val("v_start"),
    scheduled_end: val("v_end")
  });

  $("visit_create_msg").textContent = `Created visit ${res.visit_id}`;
  setVal("active_visit_id", res.visit_id);
  toast(`Visit created: ${res.visit_id}`);

  await loadVisits();
  await loadVisitFields();
  await loadRendered();
  showTab("doc");
}

async function useVisit(visit_id){
  setVal("active_visit_id", visit_id);
  await loadVisitFields();
  await loadRendered();
  showTab("doc");
}

async function openActiveVisit(){
  const id = val("active_visit_id");
  if (!id) return toast("Enter a visit ID or open from the list");
  await useVisit(id);
}

/**************** DOC ****************/
function collectFields(){
  return {
    subjective: val("f_subjective"),
    homebound: val("f_homebound"),
    referred_by: val("f_referred_by"),
    living: val("f_living"),
    history: val("f_history"),
    plof: val("f_plof"),
    falls: val("f_falls"),
    steps: val("f_steps"),
    emergency_plan: val("f_emergency_plan"),
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
    assessment: val("f_assessment"),
    goal_progress: val("f_goal_progress"),
  };
}

function fillFields(f){
  const map = {
    f_subjective:"subjective",
    f_homebound:"homebound",
    f_referred_by:"referred_by",
    f_living:"living",
    f_history:"history",
    f_plof:"plof",
    f_falls:"falls",
    f_steps:"steps",
    f_emergency_plan:"emergency_plan",
    f_rom:"rom",
    f_strength:"strength",
    f_endurance:"endurance",
    f_sensation:"sensation",
    f_transfers:"transfers",
    f_gait:"gait",
    f_balance:"balance",
    f_tinetti:"tinetti",
    f_vitals:"vitals",
    f_disease_mgmt:"disease_mgmt",
    f_precautions:"precautions",
    f_home_safety:"home_safety",
    f_phq2:"phq2",
    f_gait_training:"gait_training",
    f_transfer_training:"transfer_training",
    f_therex:"therex",
    f_assessment:"assessment",
    f_goal_progress:"goal_progress",
  };
  Object.keys(map).forEach(id => setVal(id, f?.[map[id]] || ""));
}

async function loadVisitFields(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return toast("Set an active visit first");
  const fields = await api("getVisitFields", { visit_id });
  fillFields(fields || {});
  $("doc_msg").textContent = `Loaded fields for ${visit_id}`;
  toast("Fields loaded");
}

async function forceSaveFields(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return toast("Set an active visit first");
  await api("setVisitFields", { visit_id, fields: collectFields() });
  $("doc_msg").textContent = "Saved.";
  toast("Saved");
}

async function renderNote(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return toast("Set an active visit first");
  await forceSaveFields();
  const res = await api("renderNote", { visit_id });
  $("rendered_note").textContent = res.note_text || "";
  toast(`Rendered ${res.template}`);
}

async function loadRendered(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return;
  const rn = await api("getRenderedNote", { visit_id });
  $("rendered_note").textContent = rn?.note_text || "";
}

async function signAndLock(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return toast("Set an active visit first");
  if (!confirm("Sign & lock this note? No edits after.")) return;
  await api("signNote", { visit_id });
  toast("Signed & locked");
  await loadRendered();
}

/**************** AUTOSAVE ****************/
function wireAutosave(){
  document.querySelectorAll('[data-autosave="1"]').forEach(el=>{
    el.addEventListener("input", scheduleAutosave);
  });
}

function scheduleAutosave(){
  state.autosaveDirty = true;
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(async ()=>{
    if (!state.autosaveDirty) return;
    const visit_id = val("active_visit_id");
    if (!visit_id) return;
    try {
      await api("setVisitFields", { visit_id, fields: collectFields() });
      $("doc_msg").textContent = "Autosaved.";
    } catch (_) {}
    state.autosaveDirty = false;
  }, 1000);
}

/**************** CALENDAR ****************/
async function loadCalendar(){
  const rows = await api("listCalendar", {
    fromIso: val("cal_from") || null,
    toIso: val("cal_to") || null
  });

  $("calendar_list").innerHTML = rows.map(r => `
    <div class="item">
      <div>
        <div class="t">${esc(r.start || "")} • ${esc(r.patient_label || "")}</div>
        <div class="m">${esc(r.address || "(address hidden)")}</div>
        <div class="m">${esc(r.clinician_email || "")} • visit ${esc(r.visit_id || "")}</div>
      </div>
      <div class="row" style="flex:0 0 auto">
        <button class="btn good" onclick="useVisit('${r.visit_id}')">Open</button>
      </div>
    </div>
  `).join("");

  toast(`Loaded ${rows.length} calendar items`);
}

/**************** SAFETY ****************/
async function triggerEmergency(){
  const visit_id = val("active_visit_id");
  if (!visit_id) return toast("Set an active visit first");

  const location = await getLocationString().catch(()=> "");
  const type = prompt("Emergency type (fall, threat, medical):", "Emergency") || "Emergency";
  const severity = prompt("Severity (Low/Medium/High/Critical):", "High") || "High";
  const situation = prompt("Brief situation:", "") || "";

  const res = await api("triggerEmergency", { visit_id, type, severity, situation, location });
  alert(`Emergency logged: ${res.incident_id}`);
  if (confirm("Call 911 now?")) window.location.href = "tel:911";
}

function getLocationString(){
  return new Promise((resolve)=>{
    if (!navigator.geolocation) return resolve("");
    navigator.geolocation.getCurrentPosition(
      (pos)=> resolve(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`),
      ()=> resolve(""),
      { enableHighAccuracy:true, timeout:8000 }
    );
  });
}

/**************** ADMIN ****************/
async function adminLoadUsers(){
  const rows = await api("adminListUsers", {});
  $("admin_users_list").innerHTML = rows.map(u => `
    <div class="item">
      <div>
        <div class="t">${esc(u.email)} <span class="badge">${esc(u.role)}</span></div>
        <div class="m">active: ${esc(u.active)} • last login: ${esc(u.last_login_at || "")}</div>
      </div>
      <div style="flex:0 0 auto">
        <button class="btn" onclick="adminPrefillUser('${escJs(u.email)}','${escJs(u.role)}','${escJs(u.active)}')">Edit</button>
      </div>
    </div>
  `).join("");
  toast(`Loaded ${rows.length} users`);
}

function adminPrefillUser(email, role, active){
  setVal("admin_user_email", email);
  setVal("admin_user_role", role);
  setVal("admin_user_active", active);
}

async function adminSaveUser(){
  const email = val("admin_user_email");
  const role = val("admin_user_role");
  const active = val("admin_user_active");
  await api("adminUpsertUser", { email, role, active });
  toast("User saved");
  await adminLoadUsers();
}

function adminSearchPatientsDebounced(){
  clearTimeout(state.adminPatientTimer);
  state.adminPatientTimer = setTimeout(adminSearchPatients, 300);
}

async function adminSearchPatients(){
  const q = val("admin_patient_q");
  if (!q) { $("admin_patients_list").innerHTML = ""; return; }
  const rows = await api("adminSearchPatients", { q });
  $("admin_patients_list").innerHTML = rows.map(p => `
    <div class="item">
      <div>
        <div class="t">${esc(p.last)}, ${esc(p.first)} <span class="badge">${esc(p.patient_id)}</span></div>
        <div class="m">${esc(p.dob || "")} • ${esc(p.phone || "")}</div>
        <div class="m">${esc(p.address || "")}</div>
      </div>
      <div style="flex:0 0 auto">
        <button class="btn good" onclick="adminOpenPatient('${p.patient_id}')">Open</button>
      </div>
    </div>
  `).join("");
}

function adminOpenPatient(pid){
  // Switch to Patients tab, select it
  showTab("patients");
  $("patient_select").value = pid;
  selectPatient(pid);
}

/**************** ESCAPING ****************/
function esc(s){
  return String(s || "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function escJs(s){
  return String(s || "").replaceAll("\\","\\\\").replaceAll("'","\\'");
}

/**************** START ****************/
boot();
