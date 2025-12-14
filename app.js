/* app.js - JHCAPP Frontend (GitHub Pages)
 * - Uses GAS JSON API via fetch (text/plain) to avoid CORS preflight
 * - Token stored in localStorage
 * - Single-call bootstrap => {me, patients, visits}
 * - Visits: SOC checklist + note render + sign/lock
 * - Patients: upsert (basic)
 * - Calendar: list
 * - Admin: set password (admin/supervisor)
 * - Audio recording: MediaRecorder -> base64 -> recordings.upload
 */

const API_URL = "https://script.google.com/macros/s/AKfycbx2bjC8q_1PMHmvO3bufmPU2vDh6w_ojt81g2u8bm3B3MsxQIp040dGvX7JETZy0Tye/exec"; // <-- YOUR /exec URL

/**********************
 * Small DOM helpers
 **********************/
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");
const setText = (id, t) => { const el=$(id); if(el) el.textContent = t ?? ""; };
const setHtml = (id, h) => { const el=$(id); if(el) el.innerHTML = h ?? ""; };
const escapeHtml = (s) => String(s ?? "")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

const LS_TOKEN = "jhc_token";

/**********************
 * State
 **********************/
const state = {
  token: null,
  me: null,
  patients: [],
  visits: [],
  activeVisitId: "",
  soc: {}, // current SOC fields for active visit
  locked: false,
  autosaveTimer: null,
  rec: { mediaRecorder:null, chunks:[], blob:null, startedAt:null, endedAt:null }
};

/**********************
 * Network: GAS API
 * IMPORTANT: text/plain to avoid CORS preflight
 **********************/
async function api(action, payload = {}) {
  if (!API_URL || API_URL.includes("PASTE_YOUR_GAS_EXEC_URL_HERE")) {
    throw new Error("API_URL not set (edit app.js)");
  }
  setNet("Working…");

  const body = { action, ...payload };
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  });

  const text = await res.text();

  let data;
  try { data = JSON.parse(text); }
  catch {
    console.error("Non-JSON response:", text);
    throw new Error("API returned non-JSON (deployment access likely wrong).");
  }

  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `API error (${res.status})`);
  }

  setNet("Idle");
  return data;
}

function setNet(t) {
  const el = $("net_state");
  if (el) el.textContent = t;
}

/**********************
 * AUTH UI
 **********************/
function setAuthMsg(msg, isErr=false) {
  const el = $("auth_msg");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isErr ? "var(--bad)" : "var(--muted)";
}

function setAppMsg(id, msg, isErr=false) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isErr ? "var(--bad)" : "var(--muted)";
}

function setDocMsg(msg, isErr=false) {
  setAppMsg("doc_msg", msg, isErr);
}
function setVisitMsg(msg, isErr=false) {
  setAppMsg("visit_msg", msg, isErr);
}
function setPatientMsg(msg, isErr=false) {
  setAppMsg("patient_msg", msg, isErr);
}
function setAdminMsg(msg, isErr=false) {
  setAppMsg("admin_msg", msg, isErr);
}

function switchAuthTab(which) {
  const loginTab = $("tab_login");
  const signupTab = $("tab_signup");
  const loginPanel = $("login_panel");
  const signupPanel = $("signup_panel");

  if (which === "login") {
    loginTab.classList.add("active");
    signupTab.classList.remove("active");
    signupPanel.classList.add("hidden");
    loginPanel.classList.remove("hidden");
  } else {
    signupTab.classList.add("active");
    loginTab.classList.remove("active");
    loginPanel.classList.add("hidden");
    signupPanel.classList.remove("hidden");
  }
  setAuthMsg("");
}

async function authSignup() {
  try {
    setAuthMsg("");
    const email = $("signup_email").value.trim();
    const password = $("signup_pass").value;
    const data = await api("auth.signup", { email, password });
    state.token = data.token;
    localStorage.setItem(LS_TOKEN, state.token);
    await bootstrap();
  } catch (e) {
    setAuthMsg(String(e.message || e), true);
  }
}

async function authLogin() {
  try {
    setAuthMsg("");
    const email = $("login_email").value.trim();
    const password = $("login_pass").value;
    const data = await api("auth.login", { email, password });
    state.token = data.token;
    localStorage.setItem(LS_TOKEN, state.token);
    await bootstrap();
  } catch (e) {
    setAuthMsg(String(e.message || e), true);
  }
}

function logout() {
  state.token = null;
  state.me = null;
  state.patients = [];
  state.visits = [];
  state.activeVisitId = "";
  state.soc = {};
  state.locked = false;
  state.rec = { mediaRecorder:null, chunks:[], blob:null, startedAt:null, endedAt:null };

  localStorage.removeItem(LS_TOKEN);

  // Clear all UI content (so nothing shows while logged out)
  clearAppUI();

  hide($("app"));
  show($("auth_overlay"));
  switchAuthTab("login");
  setAuthMsg("Logged out.");
}

function clearAppUI() {
  // Visits list
  setHtml("visits_list", "");
  // Patient selects
  if ($("patient_select")) $("patient_select").innerHTML = `<option value="">Select patient...</option>`;
  if ($("create_patient")) $("create_patient").innerHTML = `<option value="">Select patient...</option>`;
  // Patient form
  ["p_first","p_last","p_dob","p_phone","p_address","p_notes"].forEach(id => { if($(id)) $(id).value=""; });
  // Active visit / note / soc
  if ($("active_visit")) $("active_visit").value = "";
  setHtml("soc_form", "");
  setText("rendered_note", "");
  setDocMsg("");
  setVisitMsg("");
  setPatientMsg("");
  setAdminMsg("");
  // Calendar
  setHtml("calendar_list", "");
  // Recording
  if ($("rec_playback")) $("rec_playback").src = "";
  if ($("rec_upload")) $("rec_upload").disabled = true;
  if ($("rec_stop")) $("rec_stop").disabled = true;
  if ($("rec_start")) $("rec_start").disabled = false;
  setText("rec_status", "Not recording.");
}

/**********************
 * Bootstrap (fast login)
 **********************/
async function bootstrap() {
  try {
    const data = await api("bootstrap", { token: state.token });
    state.me = data.me;
    state.patients = data.patients || [];
    state.visits = data.visits || [];

    // Show app
    hide($("auth_overlay"));
    show($("app"));

    // Fill sidebar
    setText("me_email", state.me.email || "");
    setText("me_role", state.me.role || "");

    // Admin nav
    const isAdmin = (state.me.role === "admin" || state.me.role === "supervisor");
    $("admin_nav").style.display = isAdmin ? "block" : "none";

    // Populate selects
    renderPatientSelects();
    renderVisitsList();

    // Default to visits view
    setView("visits");

    setVisitMsg("");
    setDocMsg("");
    setNet("Idle");
  } catch (e) {
    console.error(e);
    // if token bad -> force logout state
    logout();
    setAuthMsg("Session expired. Please log in again.", true);
  }
}

/**********************
 * Navigation views
 **********************/
function setView(viewName) {
  // nav highlight
  document.querySelectorAll(".navbtn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });

  // views
  ["visits","patients","calendar","admin"].forEach(v => {
    const el = $("view_" + v);
    if (!el) return;
    if (v === viewName) el.classList.remove("hidden");
    else el.classList.add("hidden");
  });
}

/**********************
 * Patients
 **********************/
function renderPatientSelects() {
  const patients = state.patients.slice().sort((a,b) => {
    const al = String(a.last||"").toLowerCase();
    const bl = String(b.last||"").toLowerCase();
    return al.localeCompare(bl);
  });

  const options = [`<option value="">Select patient...</option>`]
    .concat(patients.map(p => {
      const label = `${escapeHtml(p.last)}, ${escapeHtml(p.first)} (${escapeHtml(p.patient_id)})`;
      return `<option value="${escapeHtml(p.patient_id)}">${label}</option>`;
    }))
    .join("");

  if ($("patient_select")) $("patient_select").innerHTML = options;
  if ($("create_patient")) $("create_patient").innerHTML = options;
}

function loadPatientIntoForm(pid) {
  const p = state.patients.find(x => x.patient_id === pid);
  if (!p) {
    ["p_first","p_last","p_dob","p_phone","p_address","p_notes"].forEach(id => { if($(id)) $(id).value=""; });
    return;
  }
  $("p_first").value = p.first || "";
  $("p_last").value = p.last || "";
  $("p_dob").value = p.dob || "";
  $("p_phone").value = p.phone || "";
  $("p_address").value = p.address || "";
  $("p_notes").value = p.notes || "";
}

async function savePatient() {
  try {
    setPatientMsg("");
    const pid = $("patient_select").value.trim();
    const patient = {
      patient_id: pid,
      first: $("p_first").value.trim(),
      last: $("p_last").value.trim(),
      dob: $("p_dob").value.trim(),
      phone: $("p_phone").value.trim(),
      address: $("p_address").value.trim(),
      notes: $("p_notes").value.trim(),
      active: "Y"
    };

    const data = await api("patients.upsert", { token: state.token, patient });
    // update local cache
    const saved = data.patient;
    const idx = state.patients.findIndex(x => x.patient_id === saved.patient_id);
    if (idx >= 0) state.patients[idx] = saved;
    else state.patients.push(saved);

    renderPatientSelects();
    $("patient_select").value = saved.patient_id;
    loadPatientIntoForm(saved.patient_id);

    setPatientMsg(`Saved patient ${saved.patient_id}`);
  } catch (e) {
    setPatientMsg(String(e.message || e), true);
  }
}

function newPatient() {
  $("patient_select").value = "";
  ["p_first","p_last","p_dob","p_phone","p_address","p_notes"].forEach(id => { if($(id)) $(id).value=""; });
  setPatientMsg("New patient: fill fields then Save.");
}

/**********************
 * Visits
 **********************/
function renderVisitsList() {
  const container = $("visits_list");
  if (!container) return;

  const visits = state.visits || [];
  if (!visits.length) {
    container.innerHTML = `<div class="item"><div><b>No visits yet.</b></div><div class="muted">Create one on the left.</div></div>`;
    return;
  }

  container.innerHTML = visits.map(v => {
    const title = `${escapeHtml(v.visit_id)} — ${escapeHtml(v.visit_type)} — ${escapeHtml(v.status || "")}`;
    const sub = `patient: ${escapeHtml(v.patient_id)} | start: ${escapeHtml(v.scheduled_start || "")}`;
    return `
      <div class="item">
        <div><b>${title}</b></div>
        <div class="muted">${sub}</div>
        <div class="row">
          <button class="btn" data-open="${escapeHtml(v.visit_id)}">Open</button>
        </div>
      </div>
    `;
  }).join("");

  // bind buttons
  container.querySelectorAll("button[data-open]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-open");
      await openVisit(id);
    });
  });
}

async function refreshVisits() {
  const data = await api("visits.list", { token: state.token, limit: 100 });
  state.visits = data.visits || [];
  renderVisitsList();
}

async function createVisit() {
  try {
    setVisitMsg("");
    const patient_id = $("create_patient").value.trim();
    const visit_type = $("create_type").value;
    const share_to_calendar = $("create_share").value;
    const scheduled_start = $("create_start").value ? new Date($("create_start").value).toISOString() : "";
    const scheduled_end = $("create_end").value ? new Date($("create_end").value).toISOString() : "";

    if (!patient_id) throw new Error("Pick a patient.");

    const data = await api("visits.create", {
      token: state.token,
      visit: { patient_id, visit_type, share_to_calendar, scheduled_start, scheduled_end }
    });

    // push into local visits (front-end expects newest first)
    state.visits.unshift(data.visit);
    renderVisitsList();

    // open it
    await openVisit(data.visit.visit_id);
    setVisitMsg(`Created visit ${data.visit.visit_id}`);
  } catch (e) {
    setVisitMsg(String(e.message || e), true);
  }
}

async function openVisit(visitId) {
  state.activeVisitId = visitId;
  $("active_visit").value = visitId;
  setDocMsg(`Loading ${visitId}…`);

  // Load SOC + rendered + lock state
  await loadSoc();
  await loadRendered();
  setDocMsg(`Loaded ${visitId}`);
}

async function loadSoc() {
  const visit_id = state.activeVisitId || $("active_visit").value.trim();
  if (!visit_id) return;

  const data = await api("soc.get", { token: state.token, visit_id });
  state.soc = data.soc || {};
  state.locked = !!data.locked;

  buildSocChecklistUI();
  updateLockedUI();
}

async function saveSocNow() {
  const visit_id = state.activeVisitId || $("active_visit").value.trim();
  if (!visit_id) throw new Error("No active visit id.");
  if (state.locked) throw new Error("Visit is locked (signed).");

  const soc = collectSocFromUI();
  state.soc = soc;
  await api("soc.set", { token: state.token, visit_id, soc });
}

async function loadRendered() {
  const visit_id = state.activeVisitId || $("active_visit").value.trim();
  if (!visit_id) return;
  const rn = await api("notes.getRendered", { token: state.token, visit_id });
  $("rendered_note").textContent = rn.note_text || "";
  state.locked = (String(rn.locked || "") === "Y");
  updateLockedUI();
}

async function generateNote() {
  try {
    setDocMsg("");
    const visit_id = state.activeVisitId || $("active_visit").value.trim();
    if (!visit_id) throw new Error("No active visit id.");

    await saveSocNow();
    const res = await api("notes.render", { token: state.token, visit_id });
    $("rendered_note").textContent = res.note_text || "";
    setDocMsg(`Generated ${res.template} note.`);
  } catch (e) {
    setDocMsg(String(e.message || e), true);
  }
}

async function signAndLock() {
  try {
    const visit_id = state.activeVisitId || $("active_visit").value.trim();
    if (!visit_id) throw new Error("No active visit id.");
    if (!confirm("Sign & lock? No edits after this.")) return;

    await api("notes.sign", { token: state.token, visit_id });
    state.locked = true;
    updateLockedUI();
    await loadRendered();
    await refreshVisits();
    setDocMsg("Signed & locked.");
  } catch (e) {
    setDocMsg(String(e.message || e), true);
  }
}

function updateLockedUI() {
  const locked = !!state.locked;
  // disable SOC inputs when locked
  const socWrap = $("soc_form");
  if (socWrap) {
    socWrap.querySelectorAll("input,select,textarea").forEach(el => {
      el.disabled = locked;
    });
  }
  $("btn_generate").disabled = locked;
  $("btn_save").disabled = locked;
}

/**********************
 * SOC Checklist UI
 * Keys MUST match backend renderSocExact_ keys.
 **********************/
const SOC_SCHEMA = [
  { group:"Header", fields:[
    { k:"insurance", label:"Insurance *", type:"text", placeholder:"" },
  ]},
  { group:"SOC subjective tokens", fields:[
    { k:"admit_date", label:"Admit date *", type:"date" },
    { k:"recent_hosp_related_to", label:"Recent hospitalization / related to *", type:"text" },
    { k:"homebound_due_to_phrase", label:"Homebound due to (exact phrase) *", type:"text" },
    { k:"referred_by_dr", label:"Referred by DR. *", type:"text" },
    { k:"assist_with_adls", label:"Assist with ADLs *", type:"text" },
  ]},
  { group:"Goal + Plan", fields:[
    { k:"goal_quote", label:'GOAL: "___" *', type:"text" },
    { k:"additional_comments", label:"ADDITIONAL COMMENTS *", type:"text" },
    { k:"plan_sentence", label:"PLAN (exact sentence if different)", type:"text" },
  ]},
  { group:"Advance Directive/POA", fields:[
    { k:"ad_poa_educated", label:"Patient/caregiver instructed/educated *", type:"select", options:["YES","NO"] },
    { k:"ad_poa_reviewed", label:"Forms provided and reviewed *", type:"select", options:["YES","NO"] },
    { k:"ad_poa_left", label:"Forms left in home *", type:"select", options:["YES","NO"] },
  ]},
  { group:"Medication Safety", fields:[
    { k:"med_changed_updated", label:"Changed/Updated medications *", type:"text" },
    { k:"med_reconciliation", label:"Performed medication reconciliation this date *", type:"text" },
    { k:"meds_present", label:"All medications present in home *", type:"text" },
  ]},
  { group:"Skilled Obs + Dx flags", fields:[
    { k:"teaching_training_for", label:"Teaching and training for *", type:"text" },
    { k:"vitals_within_params", label:"Vitals within parameters? *", type:"text" },
    { k:"who_notified", label:"Who notified (Case Manager/PCP) *", type:"text" },

    { k:"dx_htn", label:"HTN *", type:"select", options:["YES","NO"] },
    { k:"dx_copd", label:"COPD *", type:"select", options:["YES","NO"] },
    { k:"dx_depression", label:"DEPRESSION *", type:"select", options:["YES","NO"] },
    { k:"dx_dmii", label:"DMII *", type:"select", options:["YES","NO"] },
    { k:"dx_chf", label:"CHF *", type:"select", options:["YES","NO"] },
  ]},
  { group:"Cardiovascular", fields:[
    { k:"cv_edema", label:"Edema *", type:"text" },
    { k:"cv_palpitations", label:"Palpitations *", type:"text" },
    { k:"cv_endurance", label:"Endurance *", type:"text" },
    { k:"cv_unable_weigh", label:"Unable to weigh due to *", type:"text" },
    { k:"cv_right_cm", label:"RIGHT (ankle/calf) cm *", type:"text" },
    { k:"cv_left_cm", label:"LEFT (ankle/calf) cm *", type:"text" },
  ]},
  { group:"Resp / GI / Wound / Infection", fields:[
    { k:"resp_uses_o2", label:"Uses supplemental oxygen *", type:"select", options:["yes","no"] },
    { k:"resp_o2_lpm", label:"Oxygen L/min", type:"text" },
    { k:"resp_o2_route", label:"Route (nasal cannula)", type:"text" },
    { k:"resp_nebulizer", label:"Nebulizer *", type:"select", options:["yes","no"] },
    { k:"resp_sob", label:"Short of Breath *", type:"select", options:["yes","no"] },

    { k:"gi_last_bm", label:"Last bowel movement *", type:"date" },
    { k:"gi_appetite", label:"Appetite *", type:"text" },

    { k:"wound_statement", label:"WOUND statement *", type:"textarea" },

    { k:"covid_symptoms_reported", label:"Covid symptoms reported *", type:"select", options:["yes","no"] },
    { k:"covid_symptoms_detail", label:"Symptoms detail/actions", type:"textarea" },
  ]},
  { group:"Home safety + Emergency preparedness + PHQ-2", fields:[
    { k:"home_safety_teaching", label:"Home safety teaching (exact phrase) *", type:"textarea" },
    { k:"emerg_family", label:"FAMILY *", type:"text" },
    { k:"emerg_with", label:"with ___ *", type:"text" },
    { k:"emerg_special_needs", label:"special needs of ___ *", type:"text" },

    { k:"phq2_interest", label:"PHQ-2 interest answer *", type:"text" },
    { k:"phq2_depressed", label:"PHQ-2 depressed answer *", type:"text" },
  ]},
  { group:"Clinical (Eval findings used in template)", fields:[
    { k:"history", label:"HISTORY *", type:"textarea" },
    { k:"plof", label:"PRIOR LEVEL OF FUNCTION *", type:"textarea" },
    { k:"fall_history", label:"HISTORY OF FALLS *", type:"textarea" },

    { k:"rom", label:"RANGE OF MOTION *", type:"text" },
    { k:"strength", label:"MANUAL MUSCLE STRENGTH *", type:"text" },
    { k:"endurance_obj", label:"ENDURANCE (objective) *", type:"text" },
    { k:"sensation", label:"SENSATION *", type:"text" },
    { k:"transfers", label:"TRANSFERS *", type:"text" },
    { k:"gait", label:"GAIT *", type:"text" },
    { k:"tinetti", label:"TINETTI *", type:"text" },
    { k:"balance_static", label:"BALANCE STATIC STANDING *", type:"text" },

    { k:"disease_mgmt", label:"DISEASE MANAGEMENT teaching/ training *", type:"textarea" },
    { k:"special_instructions_precautions", label:"SPECIAL INSTRUCTIONS/PRECAUTIONS *", type:"textarea" },

    { k:"gait_balance_training", label:"GAIT TRAINING/ BALANCE TRAINING *", type:"textarea" },
    { k:"transfer_training", label:"TRANSFER TRAINING *", type:"textarea" },
    { k:"ther_ex", label:"THERAPEUTIC EXERCISE *", type:"textarea" },
    { k:"hep_details", label:"HEP details *", type:"textarea" },

    { k:"attending_md", label:"Attending MD *", type:"text" },
    { k:"primary_dx_focus", label:"Primary Dx / focus of care *", type:"text" },
    { k:"rehosp_risks", label:"Re-hospitalization risks *", type:"text" },
    { k:"anticipated_needs_future", label:"Anticipated needs/education future visits *", type:"textarea" },

    { k:"short_term_weeks", label:"Short term goals weeks *", type:"text" },
    { k:"long_term_weeks", label:"Long term goals weeks *", type:"text" },
    { k:"patient_identified_goal", label:"Patient identified goal *", type:"text" },
  ]},
];

function buildSocChecklistUI() {
  const wrap = $("soc_form");
  if (!wrap) return;

  const soc = state.soc || {};
  const locked = !!state.locked;

  const sectionsHtml = SOC_SCHEMA.map(section => {
    const rows = section.fields.map(f => {
      const v = soc[f.k] ?? "";
      const inputId = "soc_" + f.k;

      let control = "";
      if (f.type === "select") {
        const opts = (f.options || []).map(opt => {
          const sel = String(opt).toLowerCase() === String(v).toLowerCase() ? "selected" : "";
          return `<option value="${escapeHtml(opt)}" ${sel}>${escapeHtml(opt)}</option>`;
        }).join("");
        control = `<select id="${inputId}" ${locked ? "disabled":""}>${opts}</select>`;
      } else if (f.type === "textarea") {
        control = `<textarea id="${inputId}" rows="2" ${locked ? "disabled":""}>${escapeHtml(v)}</textarea>`;
      } else if (f.type === "date") {
        // accept either YYYY-MM-DD or ISO
        const dateVal = normalizeDateForInput_(v);
        control = `<input id="${inputId}" type="date" value="${escapeHtml(dateVal)}" ${locked ? "disabled":""}/>`;
      } else {
        control = `<input id="${inputId}" value="${escapeHtml(v)}" placeholder="${escapeHtml(f.placeholder || "")}" ${locked ? "disabled":""}/>`;
      }

      return `
        <div class="socrow">
          <div class="full">
            <label>${escapeHtml(f.label)}</label>
            ${control}
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="item" style="margin-bottom:10px">
        <div><b>${escapeHtml(section.group)}</b></div>
        <div style="height:8px"></div>
        ${rows}
      </div>
    `;
  }).join("");

  wrap.innerHTML = sectionsHtml;

  // wire autosave on typing
  wireSocAutosave();
}

function normalizeDateForInput_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  // if it's ISO like 2025-12-12T...
  if (s.includes("T") && s.length >= 10) return s.slice(0,10);
  // if already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // if MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = String(m[1]).padStart(2,"0");
    const dd = String(m[2]).padStart(2,"0");
    return `${m[3]}-${mm}-${dd}`;
  }
  return "";
}

function wireSocAutosave() {
  const wrap = $("soc_form");
  if (!wrap) return;

  // Any input change triggers delayed save
  wrap.querySelectorAll("input,select,textarea").forEach(el => {
    el.addEventListener("input", () => scheduleAutosave());
    el.addEventListener("change", () => scheduleAutosave());
  });
}

function scheduleAutosave() {
  if (state.locked) return;
  if (!state.activeVisitId && !$("active_visit").value.trim()) return;

  if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(async () => {
    try {
      await saveSocNow();
      setDocMsg("Autosaved.");
    } catch (e) {
      setDocMsg(String(e.message || e), true);
    }
  }, 1000);
}

function collectSocFromUI() {
  const soc = {};
  SOC_SCHEMA.forEach(section => {
    section.fields.forEach(f => {
      const el = $("soc_" + f.k);
      if (!el) return;
      let v = el.value ?? "";
      if (f.type === "date") {
        // store as ISO date string (YYYY-MM-DD) to keep stable
        v = String(v || "").trim();
      } else {
        v = String(v || "").trim();
      }
      soc[f.k] = v;
    });
  });
  return soc;
}

/**********************
 * Calendar
 **********************/
async function loadCalendar() {
  try {
    setAppMsg("calendar_list", "");
    const fromIso = $("cal_from").value.trim() || null;
    const toIso = $("cal_to").value.trim() || null;

    const data = await api("calendar.list", { token: state.token, fromIso, toIso });
    const rows = data.rows || [];

    const html = rows.map(r => `
      <div class="item">
        <div><b>${escapeHtml(r.start || "")}</b> — ${escapeHtml(r.patient_label || "")}</div>
        <div class="muted">${escapeHtml(r.address || "(address hidden)")}</div>
        <div class="muted">${escapeHtml(r.clinician_email || "")} | visit: ${escapeHtml(r.visit_id || "")}</div>
      </div>
    `).join("");

    setHtml("calendar_list", html || `<div class="item"><b>No calendar rows.</b></div>`);
  } catch (e) {
    setHtml("calendar_list", `<div class="item"><b>Error:</b> ${escapeHtml(String(e.message||e))}</div>`);
  }
}

/**********************
 * Emergency
 **********************/
async function triggerEmergency() {
  try {
    const visit_id = state.activeVisitId || $("active_visit").value.trim();
    if (!visit_id) return alert("Set an active Visit ID first.");

    const location = await getLocationString();
    const type = prompt("Emergency type (fall, threat, medical):", "Emergency") || "Emergency";
    const severity = prompt("Severity (Low/Medium/High/Critical):", "High") || "High";
    const situation = prompt("Brief situation:", "") || "";

    const res = await api("emergency.trigger", {
      token: state.token,
      visit_id, type, severity, situation, location
    });

    alert(`Emergency logged: ${res.incident_id}`);
    if (confirm("Call 911 now?")) window.location.href = "tel:911";
  } catch (e) {
    alert(String(e.message || e));
  }
}

function getLocationString() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve("");
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`),
      () => resolve(""),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

/**********************
 * Audio recording
 **********************/
async function startRecording() {
  const visit_id = state.activeVisitId || $("active_visit").value.trim();
  if (!visit_id) return alert("Set an active Visit ID first.");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMimeType();
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

    state.rec = { mediaRecorder: mr, chunks: [], blob: null, startedAt: new Date().toISOString(), endedAt: null };

    mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) state.rec.chunks.push(e.data); };
    mr.onstop = () => {
      state.rec.endedAt = new Date().toISOString();
      state.rec.blob = new Blob(state.rec.chunks, { type: mr.mimeType || "audio/webm" });
      $("rec_playback").src = URL.createObjectURL(state.rec.blob);
      $("rec_upload").disabled = false;
      setText("rec_status", `Recorded ${Math.round(state.rec.blob.size / 1024)} KB`);
    };

    mr.start();
    $("rec_start").disabled = true;
    $("rec_stop").disabled = false;
    setText("rec_status", "Recording…");
  } catch (e) {
    alert("Mic permission denied or no mic available.");
  }
}

function stopRecording() {
  const mr = state.rec.mediaRecorder;
  if (!mr) return;
  mr.stop();
  $("rec_start").disabled = false;
  $("rec_stop").disabled = true;
}

async function uploadRecording() {
  const visit_id = state.activeVisitId || $("active_visit").value.trim();
  if (!visit_id) return alert("Set an active Visit ID first.");
  if (!state.rec.blob) return alert("No recording available.");

  try {
    setText("rec_status", "Encoding…");
    const base64 = await blobToBase64(state.rec.blob);
    setText("rec_status", "Uploading…");

    const retention_days = parseInt($("rec_retention").value || "30", 10);

    const res = await api("recordings.upload", {
      token: state.token,
      visit_id,
      filename: `rec_${visit_id}_${Date.now()}.webm`,
      mimeType: state.rec.blob.type || "audio/webm",
      base64,
      started_at: state.rec.startedAt,
      ended_at: state.rec.endedAt,
      retention_days
    });

    $("rec_upload").disabled = true;
    $("rec_status").innerHTML = `Uploaded: <a href="${res.drive_url}" target="_blank" rel="noopener">Open in Drive</a>`;
  } catch (e) {
    setText("rec_status", String(e.message || e));
  }
}

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const c of candidates) if (MediaRecorder.isTypeSupported(c)) return c;
  return "";
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(blob);
  });
}

/**********************
 * Admin
 **********************/
async function adminSetPassword() {
  try {
    setAdminMsg("");
    const email = $("admin_user_email").value.trim();
    const newPassword = $("admin_user_pass").value;
    if (!email) throw new Error("Enter user email");
    if (!newPassword || newPassword.length < 8) throw new Error("Password must be at least 8 chars");

    await api("auth.setPassword", { token: state.token, email, newPassword });
    setAdminMsg("Password set.");
  } catch (e) {
    setAdminMsg(String(e.message || e), true);
  }
}

/**********************
 * Global bindings
 **********************/
function bindUI() {
  // API label
  if ($("api_label")) $("api_label").textContent = API_URL;

  // Auth tabs
  $("tab_login").addEventListener("click", () => switchAuthTab("login"));
  $("tab_signup").addEventListener("click", () => switchAuthTab("signup"));

  // Auth buttons
  $("btn_login").addEventListener("click", authLogin);
  $("btn_signup").addEventListener("click", authSignup);

  // Nav buttons
  document.querySelectorAll(".navbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      if (view === "admin") {
        // only allow if admin nav visible
        if ($("admin_nav").style.display === "none") return;
      }
      setView(view);
    });
  });

  // Logout
  $("btn_logout").addEventListener("click", logout);

  // Refresh
  $("btn_refresh").addEventListener("click", async () => {
    try {
      await bootstrap();
      setDocMsg("Refreshed.");
    } catch (e) {
      setDocMsg(String(e.message||e), true);
    }
  });

  // Emergency
  $("btn_emergency").addEventListener("click", triggerEmergency);

  // Visits
  $("btn_create_visit").addEventListener("click", createVisit);
  $("btn_load").addEventListener("click", loadSoc);
  $("btn_save").addEventListener("click", async () => {
    try {
      await saveSocNow();
      setDocMsg("Saved.");
    } catch (e) {
      setDocMsg(String(e.message || e), true);
    }
  });
  $("btn_generate").addEventListener("click", generateNote);
  $("btn_sign").addEventListener("click", signAndLock);

  // Patients
  $("patient_select").addEventListener("change", (e) => loadPatientIntoForm(e.target.value));
  $("btn_new_patient").addEventListener("click", newPatient);
  $("btn_save_patient").addEventListener("click", savePatient);

  // Calendar
  $("btn_cal_load").addEventListener("click", loadCalendar);

  // Admin
  $("btn_admin_setpass").addEventListener("click", adminSetPassword);

  // Recording
  $("rec_start").addEventListener("click", startRecording);
  $("rec_stop").addEventListener("click", stopRecording);
  $("rec_upload").addEventListener("click", uploadRecording);
}

/**********************
 * Startup
 **********************/
async function start() {
  // Start with clean UI
  clearAppUI();

  // Bind events
  bindUI();

  // Try restore token
  const tok = localStorage.getItem(LS_TOKEN);
  if (tok) {
    state.token = tok;
    // show loading state
    setAuthMsg("Restoring session…");
    try {
      await bootstrap();
      return;
    } catch (e) {
      console.warn("bootstrap failed:", e);
      logout();
    }
  } else {
    // show auth screen
    show($("auth_overlay"));
    hide($("app"));
    switchAuthTab("login");
    setAuthMsg("");
  }
}

// kick off
start();
