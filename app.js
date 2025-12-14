/* app.js — JHC HH Doc + Safety (Frontend)
   - Calls GAS Web App via POST (text/plain to avoid CORS preflight)
   - Token session restore
   - Bootstrap (1 call) -> me + patients + visits
   - SOC checklist only (no duplicate clinical fields panel)
   - Hard logout clears everything
   - Mobile sidebar toggle (JS-driven)
*/

(() => {
  // ====== CONFIG ======
  const API_URL = window.API_URL || "https://script.google.com/macros/s/AKfycbx0ePTY8fQSCa4jcM6F97UNj3msJzg4O9wCRTZJfn_uJKRhPx92Qlrbv2LmzbTss8Sw/exec"; // e.g. https://script.google.com/macros/s/XXXX/exec
  const LS_TOKEN = "JHC_TOKEN";

  // ====== DOM HELPERS ======
  const $ = (sel) => document.querySelector(sel);

  function setMsg(el, text, ok = true) {
    if (!el) return;
    el.textContent = text || "";
    el.style.color = ok ? "rgba(233,236,255,.75)" : "rgba(255,91,110,.95)";
  }

  function setNetState(text) {
    const pill = $("#net_state");
    if (pill) pill.textContent = text || "Idle";
  }

  // ====== STATE ======
  let state = {
    token: "",
    me: null,
    patients: [],
    visits: [],
    activeVisitId: "",
    soc: {},
    socDirty: false,
    socAutosaveTimer: null,
    isMobileNavOpen: false,
  };

  // ====== API (NO PREFLIGHT) ======
  async function api(action, payload = {}) {
    const req = { action, ...payload };
    if (state.token && !req.token) req.token = state.token;

    setNetState("Working…");

    // IMPORTANT: text/plain avoids CORS preflight on GAS web apps
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(req),
    });

    const txt = await res.text();
    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      throw new Error("Bad JSON from server: " + txt.slice(0, 200));
    }

    setNetState("Idle");

    if (!data.ok) {
      throw new Error(data.error || "API error");
    }
    return data;
  }

  // ====== SOC FORM SCHEMA ======
  // This is the ONE source of truth for the SOC checklist + clinical values
  // Keys MUST match what Code.gs uses in renderSocExact_()
  const SOC_SCHEMA = [
    {
      title: "Header",
      fields: [
        { k: "insurance", label: "Insurance *", type: "text" },
        { k: "admit_date", label: "Admit date *", type: "date" },
        { k: "recent_hosp_related_to", label: "Recent hospitalization / related to *", type: "text" },
        { k: "homebound_due_to_phrase", label: "Homebound due to (exact phrase) *", type: "text" },
        { k: "referred_by_dr", label: "Referred by DR. *", type: "text" },
        { k: "assist_with_adls", label: "Assist with ADLs *", type: "text" },
      ],
    },
    {
      title: "Clinical (PT Eval basics)",
      fields: [
        { k: "history", label: "HISTORY *", type: "textarea" },
        { k: "plof", label: "PRIOR LEVEL OF FUNCTION *", type: "textarea" },
        { k: "fall_history", label: "HISTORY OF FALLS *", type: "textarea" },

        { k: "rom", label: "RANGE OF MOTION (ROM) *", type: "textarea" },
        { k: "strength", label: "MANUAL MUSCLE STRENGTH *", type: "textarea" },
        { k: "endurance_obj", label: "ENDURANCE (objective) *", type: "textarea" },
        { k: "sensation", label: "SENSATION *", type: "textarea" },
        { k: "transfers", label: "TRANSFERS *", type: "textarea" },
        { k: "gait", label: "GAIT *", type: "textarea" },
        { k: "tinetti", label: "TINETTI *", type: "text" },
        { k: "balance_static", label: "BALANCE STATIC STANDING *", type: "textarea" },
      ],
    },
    {
      title: "Goal + Plan",
      fields: [
        { k: "goal_quote", label: 'GOAL: "___" *', type: "text" },
        { k: "additional_comments", label: "ADDITIONAL COMMENTS *", type: "textarea" },
        { k: "plan_sentence", label: "PLAN (extra sentence if different)", type: "textarea" },
      ],
    },
    {
      title: "Advance Directive / POA",
      fields: [
        { k: "ad_poa_educated", label: "Patient/caregiver instructed/educated *", type: "text" },
        { k: "ad_poa_reviewed", label: "Forms provided and reviewed *", type: "text" },
        { k: "ad_poa_left", label: "Forms left in home *", type: "text" },
      ],
    },
    {
      title: "Medication Safety",
      fields: [
        { k: "med_changed_updated", label: "Changed/Updated medications *", type: "text" },
        { k: "med_reconciliation", label: "Performed medication reconciliation this date *", type: "text" },
        { k: "meds_present", label: "All medications present in home *", type: "text" },
      ],
    },
    {
      title: "Skilled Obs + Dx flags",
      fields: [
        { k: "teaching_training_for", label: "Teaching and training for *", type: "text" },
        { k: "vitals_within_params", label: "Vitals within parameters? *", type: "text" },
        { k: "who_notified", label: "Who notified (Case Manager/PCP) *", type: "text" },

        { k: "dx_htn", label: "HTN *", type: "text" },
        { k: "dx_copd", label: "COPD *", type: "text" },
        { k: "dx_depression", label: "DEPRESSION *", type: "text" },
        { k: "dx_dmii", label: "DMII *", type: "text" },
        { k: "dx_chf", label: "CHF *", type: "text" },
      ],
    },
    {
      title: "Cardiovascular",
      fields: [
        { k: "cv_edema", label: "Edema *", type: "text" },
        { k: "cv_palpitations", label: "Palpitations *", type: "text" },
        { k: "cv_endurance", label: "Endurance *", type: "text" },
        { k: "cv_unable_weigh", label: "Unable to weigh due to *", type: "text" },
        { k: "cv_right_cm", label: "RIGHT (ankle/calf) cm *", type: "text" },
        { k: "cv_left_cm", label: "LEFT (ankle/calf) cm *", type: "text" },
      ],
    },
    {
      title: "Resp / GI / Wound / Infection",
      fields: [
        { k: "resp_uses_o2", label: "Uses supplemental oxygen *", type: "text" },
        { k: "resp_o2_lpm", label: "Oxygen L/min", type: "text" },
        { k: "resp_o2_route", label: "Route (nasal cannula)", type: "text" },
        { k: "resp_nebulizer", label: "Nebulizer *", type: "text" },
        { k: "resp_sob", label: "Short of Breath *", type: "text" },

        { k: "gi_last_bm", label: "Last bowel movement *", type: "date" },
        { k: "gi_appetite", label: "Appetite *", type: "text" },

        { k: "wound_statement", label: "WOUND statement *", type: "textarea" },

        { k: "covid_symptoms_reported", label: "Covid symptoms reported *", type: "text" },
        { k: "covid_symptoms_detail", label: "Symptoms detail/actions", type: "textarea" },
      ],
    },
    {
      title: "Home safety + Emergency preparedness + PHQ-2",
      fields: [
        { k: "home_safety_teaching", label: "Home safety teaching (exact phrase) *", type: "textarea" },
        { k: "emerg_family", label: "FAMILY *", type: "text" },
        { k: "emerg_with", label: "with ___ *", type: "text" },
        { k: "emerg_special_needs", label: "special needs of ___ *", type: "text" },

        { k: "phq2_interest", label: "PHQ-2 interest answer *", type: "text" },
        { k: "phq2_depressed", label: "PHQ-2 depressed answer *", type: "text" },
      ],
    },
    {
      title: "Interventions + HEP + MD/risks/goals",
      fields: [
        { k: "gait_balance_training", label: "GAIT/BALANCE TRAINING *", type: "textarea" },
        { k: "transfer_training", label: "TRANSFER TRAINING *", type: "textarea" },
        { k: "ther_ex", label: "THER EX *", type: "textarea" },

        { k: "hep_details", label: "HEP details *", type: "textarea" },
        { k: "attending_md", label: "Attending MD *", type: "text" },
        { k: "primary_dx_focus", label: "Primary Dx / focus of care *", type: "text" },
        { k: "rehosp_risks", label: "Re-hospitalization risks *", type: "text" },
        { k: "anticipated_needs_future", label: "Anticipated needs/education future visits *", type: "textarea" },

        { k: "short_term_weeks", label: "Short term goals weeks *", type: "text" },
        { k: "long_term_weeks", label: "Long term goals weeks *", type: "text" },
        { k: "patient_identified_goal", label: "Patient identified goal *", type: "text" },
      ],
    },
    {
      title: "Disease mgmt + precautions",
      fields: [
        { k: "disease_mgmt", label: "DISEASE MANAGEMENT teaching/ training *", type: "textarea" },
        { k: "special_instructions_precautions", label: "SPECIAL INSTRUCTIONS/PRECAUTIONS *", type: "textarea" },
      ],
    },
  ];

  // ====== RENDER SOC FORM ======
  function renderSocForm(container) {
    if (!container) return;
    container.innerHTML = "";

    SOC_SCHEMA.forEach((section) => {
      const h = document.createElement("div");
      h.style.fontWeight = "900";
      h.style.margin = "10px 0 8px";
      h.textContent = section.title;
      container.appendChild(h);

      section.fields.forEach((f) => {
        const wrap = document.createElement("div");
        wrap.style.marginBottom = "10px";

        const lab = document.createElement("label");
        lab.textContent = f.label;
        wrap.appendChild(lab);

        let input;
        if (f.type === "textarea") {
          input = document.createElement("textarea");
          input.rows = 2;
        } else {
          input = document.createElement("input");
          input.type = (f.type === "date") ? "date" : "text";
        }

        input.value = state.soc[f.k] || "";
        input.dataset.k = f.k;

        input.addEventListener("input", () => {
          state.soc[f.k] = input.value;
          state.socDirty = true;
          scheduleSocAutosave();
        });

        wrap.appendChild(input);
        container.appendChild(wrap);
      });
    });
  }

  function scheduleSocAutosave() {
    clearTimeout(state.socAutosaveTimer);
    state.socAutosaveTimer = setTimeout(async () => {
      if (!state.activeVisitId) return;
      if (!state.socDirty) return;
      try {
        await api("soc.set", { visit_id: state.activeVisitId, soc: state.soc });
        state.socDirty = false;
        setMsg($("#doc_msg"), "Autosaved.");
      } catch (e) {
        setMsg($("#doc_msg"), "Autosave failed: " + e.message, false);
      }
    }, 900);
  }

  // ====== AUTH + SESSION ======
  function showAuth() {
    $("#auth_overlay")?.classList.remove("hidden");
    $("#app")?.classList.add("hidden");
  }
  function showApp() {
    $("#auth_overlay")?.classList.add("hidden");
    $("#app")?.classList.remove("hidden");
  }

  function hardLogout() {
    localStorage.removeItem(LS_TOKEN);

    state = {
      token: "",
      me: null,
      patients: [],
      visits: [],
      activeVisitId: "",
      soc: {},
      socDirty: false,
      socAutosaveTimer: null,
      isMobileNavOpen: false,
    };

    // Clear DOM
    if ($("#me_email")) $("#me_email").textContent = "";
    if ($("#me_role")) $("#me_role").textContent = "";
    if ($("#visits_list")) $("#visits_list").innerHTML = "";
    if ($("#soc_form")) $("#soc_form").innerHTML = "";
    if ($("#rendered_note")) $("#rendered_note").textContent = "";
    if ($("#active_visit")) $("#active_visit").value = "";
    if ($("#visit_msg")) $("#visit_msg").textContent = "";
    if ($("#doc_msg")) $("#doc_msg").textContent = "";
    if ($("#patient_msg")) $("#patient_msg").textContent = "";
    if ($("#admin_msg")) $("#admin_msg").textContent = "";
    if ($("#calendar_list")) $("#calendar_list").innerHTML = "";

    setNetState("Idle");
    showAuth();
  }

  async function doBootstrap() {
    const data = await api("bootstrap", {});
    state.me = data.me;
    state.patients = data.patients || [];
    state.visits = data.visits || [];

    $("#me_email").textContent = "User: " + (state.me?.email || "");
    $("#me_role").textContent = "Role: " + (state.me?.role || "");

    // Admin tab visibility
    const isAdmin = ["admin", "supervisor"].includes(String(state.me?.role || ""));
    const adminNav = $("#admin_nav");
    if (adminNav) adminNav.style.display = isAdmin ? "" : "none";

    renderPatientsSelects();
    renderVisitsList();
  }

  // ====== NAV / VIEWS ======
  function setView(view) {
    const views = ["visits", "patients", "calendar", "admin"];
    views.forEach((v) => {
      const el = $("#view_" + v);
      if (!el) return;
      el.classList.toggle("hidden", v !== view);
    });

    document.querySelectorAll(".navbtn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });

    // close mobile nav after selection
    closeMobileNav();
  }

  // ====== VISITS ======
  function patientLabel(p) {
    const name = [p.last, p.first].filter(Boolean).join(", ");
    return name || p.patient_id;
  }

  function renderVisitsList() {
    const box = $("#visits_list");
    if (!box) return;
    box.innerHTML = "";

    const visits = (state.visits || []).slice(0, 100);

    visits.forEach((v) => {
      const item = document.createElement("div");
      item.className = "item";

      const pat = state.patients.find((p) => p.patient_id === v.patient_id);
      const patName = pat ? patientLabel(pat) : v.patient_id;

      const title = document.createElement("b");
      title.textContent = `${v.visit_id} — ${v.visit_type} — ${v.status}`;
      item.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "muted";
      meta.textContent = `patient: ${patName} • start: ${v.scheduled_start || ""}`;
      item.appendChild(meta);

      const row = document.createElement("div");
      row.className = "row";
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Open";
      btn.onclick = () => openVisit(v.visit_id);
      row.appendChild(btn);
      item.appendChild(row);

      box.appendChild(item);
    });
  }

  async function openVisit(visitId) {
    state.activeVisitId = visitId;
    $("#active_visit").value = visitId;
    setMsg($("#doc_msg"), "Loading…");

    // load SOC + rendered note in parallel
    try {
      const [socRes, noteRes] = await Promise.all([
        api("soc.get", { visit_id: visitId }),
        api("notes.getRendered", { visit_id: visitId }),
      ]);

      state.soc = socRes.soc || {};
      renderSocForm($("#soc_form"));

      $("#rendered_note").textContent = (noteRes.note_text || "").trim();
      setMsg($("#doc_msg"), socRes.locked ? "Visit is SIGNED/LOCKED." : "Loaded.");
    } catch (e) {
      setMsg($("#doc_msg"), "Load failed: " + e.message, false);
    }
  }

  async function createVisit() {
    const patient_id = $("#create_patient").value;
    const visit_type = $("#create_type").value;
    const share_to_calendar = $("#create_share").value;
    const scheduled_start = $("#create_start").value ? new Date($("#create_start").value).toISOString() : "";
    const scheduled_end = $("#create_end").value ? new Date($("#create_end").value).toISOString() : "";

    try {
      const data = await api("visits.create", {
        visit: { patient_id, visit_type, share_to_calendar, scheduled_start, scheduled_end },
      });
      setMsg($("#visit_msg"), "Created " + data.visit.visit_id);
      await refreshAll();
      await openVisit(data.visit.visit_id);
    } catch (e) {
      setMsg($("#visit_msg"), e.message, false);
    }
  }

  async function refreshAll() {
    try {
      await doBootstrap();
      setMsg($("#visit_msg"), "Refreshed.");
    } catch (e) {
      setMsg($("#visit_msg"), "Refresh failed: " + e.message, false);
    }
  }

  // ====== PATIENTS ======
  function renderPatientsSelects() {
    const createSel = $("#create_patient");
    const sel = $("#patient_select");

    const opts = (state.patients || []).map((p) => ({
      id: p.patient_id,
      label: `${patientLabel(p)} (${p.patient_id})`,
    }));

    function fill(selectEl) {
      if (!selectEl) return;
      selectEl.innerHTML = "";
      opts.forEach((o) => {
        const op = document.createElement("option");
        op.value = o.id;
        op.textContent = o.label;
        selectEl.appendChild(op);
      });
    }

    fill(createSel);
    fill(sel);

    if (sel && opts.length) {
      sel.onchange = () => loadPatientForm(sel.value);
      loadPatientForm(sel.value);
    }
  }

  function loadPatientForm(patientId) {
    const p = state.patients.find((x) => x.patient_id === patientId);
    if (!p) return;

    $("#p_first").value = p.first || "";
    $("#p_last").value = p.last || "";
    $("#p_dob").value = p.dob || "";
    $("#p_phone").value = p.phone || "";
    $("#p_address").value = p.address || "";
    $("#p_notes").value = p.notes || "";
  }

  async function savePatient() {
    const sel = $("#patient_select");
    const currentId = sel.value;
    const existing = state.patients.find((p) => p.patient_id === currentId);

    const payload = {
      patient_id: existing?.patient_id || "",
      first: $("#p_first").value.trim(),
      last: $("#p_last").value.trim(),
      dob: $("#p_dob").value.trim(),
      phone: $("#p_phone").value.trim(),
      address: $("#p_address").value.trim(),
      notes: $("#p_notes").value.trim(),
    };

    try {
      await api("patients.upsert", { patient: payload });
      setMsg($("#patient_msg"), "Saved.");
      await refreshAll();
    } catch (e) {
      setMsg($("#patient_msg"), e.message, false);
    }
  }

  function newPatient() {
    $("#p_first").value = "";
    $("#p_last").value = "";
    $("#p_dob").value = "";
    $("#p_phone").value = "";
    $("#p_address").value = "";
    $("#p_notes").value = "";
    setMsg($("#patient_msg"), "Enter info and press Save.");
  }

  // ====== DOC ACTIONS ======
  async function saveSoc() {
    if (!state.activeVisitId) return setMsg($("#doc_msg"), "Pick a visit first.", false);
    try {
      await api("soc.set", { visit_id: state.activeVisitId, soc: state.soc });
      state.socDirty = false;
      setMsg($("#doc_msg"), "Saved.");
    } catch (e) {
      setMsg($("#doc_msg"), e.message, false);
    }
  }

  async function loadSoc() {
    if (!state.activeVisitId) return setMsg($("#doc_msg"), "Pick a visit first.", false);
    try {
      const data = await api("soc.get", { visit_id: state.activeVisitId });
      state.soc = data.soc || {};
      renderSocForm($("#soc_form"));
      setMsg($("#doc_msg"), "Loaded.");
    } catch (e) {
      setMsg($("#doc_msg"), e.message, false);
    }
  }

  async function generateNote() {
    if (!state.activeVisitId) return setMsg($("#doc_msg"), "Pick a visit first.", false);
    try {
      const data = await api("notes.render", { visit_id: state.activeVisitId });
      $("#rendered_note").textContent = (data.note_text || "").trim();
      setMsg($("#doc_msg"), "Generated.");
    } catch (e) {
      setMsg($("#doc_msg"), e.message, false);
    }
  }

  async function signAndLock() {
    if (!state.activeVisitId) return setMsg($("#doc_msg"), "Pick a visit first.", false);
    const ok = confirm("Sign & lock this visit? (No more edits after this)");
    if (!ok) return;
    try {
      await api("notes.sign", { visit_id: state.activeVisitId });
      setMsg($("#doc_msg"), "SIGNED/LOCKED.");
    } catch (e) {
      setMsg($("#doc_msg"), e.message, false);
    }
  }

  // ====== CALENDAR ======
  async function loadCalendar() {
    try {
      const fromIso = $("#cal_from").value.trim() || null;
      const toIso = $("#cal_to").value.trim() || null;
      const data = await api("calendar.list", { fromIso, toIso });

      const box = $("#calendar_list");
      box.innerHTML = "";
      (data.rows || []).forEach((r) => {
        const div = document.createElement("div");
        div.className = "item";
        div.innerHTML = `<b>${r.start || ""}</b><div class="muted">${r.patient_label || ""} • ${r.address || ""}</div>`;
        box.appendChild(div);
      });
    } catch (e) {
      alert("Calendar load failed: " + e.message);
    }
  }

  // ====== ADMIN ======
  async function adminSetPass() {
    try {
      const email = $("#admin_user_email").value.trim();
      const newPassword = $("#admin_user_pass").value;
      await api("auth.setPassword", { email, newPassword });
      setMsg($("#admin_msg"), "Password set.");
    } catch (e) {
      setMsg($("#admin_msg"), e.message, false);
    }
  }

  // ====== EMERGENCY ======
  async function emergency() {
    if (!state.activeVisitId) {
      alert("Pick a visit first so the incident links to that patient/visit.");
      return;
    }

    const doLog = confirm("Log an emergency incident for this visit?");
    if (!doLog) return;

    try {
      await api("emergency.trigger", {
        visit_id: state.activeVisitId,
        type: "Emergency",
        severity: "High",
        situation: "User pressed Emergency",
        location: "",
      });
    } catch (e) {
      alert("Failed to log incident: " + e.message);
      return;
    }

    // After logging: prompt to call 911 (cannot call automatically)
    const callNow = confirm("Call 911 now?");
    if (callNow) {
      // On mobile this opens dialer; on desktop it may do nothing or prompt
      window.location.href = "tel:911";
    }
  }

  // ====== MOBILE NAV (JS-DRIVEN) ======
  function injectMobileNavButton() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;

    // Only inject once
    if ($("#btn_nav_toggle")) return;

    const btn = document.createElement("button");
    btn.id = "btn_nav_toggle";
    btn.className = "btn";
    btn.textContent = "Menu";
    btn.style.marginRight = "8px";

    btn.onclick = () => {
      state.isMobileNavOpen ? closeMobileNav() : openMobileNav();
    };

    // Insert at start of top-actions area if possible
    const actions = document.querySelector(".top-actions");
    if (actions) actions.prepend(btn);
  }

  function openMobileNav() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;

    sidebar.style.position = "fixed";
    sidebar.style.zIndex = "50";
    sidebar.style.left = "18px";
    sidebar.style.top = "18px";
    sidebar.style.bottom = "18px";
    sidebar.style.maxWidth = "88vw";
    sidebar.style.width = "320px";

    // overlay backdrop
    let overlay = $("#mobile_overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "mobile_overlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(0,0,0,.55)";
      overlay.style.zIndex = "40";
      overlay.onclick = () => closeMobileNav();
      document.body.appendChild(overlay);
    }

    state.isMobileNavOpen = true;
  }

  function closeMobileNav() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;

    // Only collapse on small screens; otherwise leave normal desktop layout alone
    if (window.innerWidth > 900) return;

    sidebar.style.position = "";
    sidebar.style.zIndex = "";
    sidebar.style.left = "";
    sidebar.style.top = "";
    sidebar.style.bottom = "";
    sidebar.style.maxWidth = "";
    sidebar.style.width = "";

    const overlay = $("#mobile_overlay");
    if (overlay) overlay.remove();

    state.isMobileNavOpen = false;
  }

  function onResize() {
    injectMobileNavButton();
    if (window.innerWidth > 900) {
      // Ensure overlay removed and sidebar normal
      const overlay = $("#mobile_overlay");
      if (overlay) overlay.remove();
      state.isMobileNavOpen = false;
    } else {
      // default closed
      closeMobileNav();
    }
  }

  // ====== INIT ======
  async function init() {
    $("#api_label").textContent = API_URL;

    // Tabs
    $("#tab_login").onclick = () => {
      $("#tab_login").classList.add("active");
      $("#tab_signup").classList.remove("active");
      $("#login_panel").classList.remove("hidden");
      $("#signup_panel").classList.add("hidden");
    };
    $("#tab_signup").onclick = () => {
      $("#tab_signup").classList.add("active");
      $("#tab_login").classList.remove("active");
      $("#signup_panel").classList.remove("hidden");
      $("#login_panel").classList.add("hidden");
    };

    // Auth
    $("#btn_login").onclick = async () => {
      try {
        setMsg($("#auth_msg"), "Logging in…");
        const email = $("#login_email").value.trim();
        const password = $("#login_pass").value;
        const data = await api("auth.login", { email, password });

        state.token = data.token;
        localStorage.setItem(LS_TOKEN, state.token);

        showApp();
        await doBootstrap();
        setView("visits");
        setMsg($("#auth_msg"), "");
      } catch (e) {
        setMsg($("#auth_msg"), e.message, false);
      }
    };

    $("#btn_signup").onclick = async () => {
      try {
        setMsg($("#auth_msg"), "Creating account…");
        const email = $("#signup_email").value.trim();
        const password = $("#signup_pass").value;
        const data = await api("auth.signup", { email, password });

        state.token = data.token;
        localStorage.setItem(LS_TOKEN, state.token);

        showApp();
        await doBootstrap();
        setView("visits");
        setMsg($("#auth_msg"), "");
      } catch (e) {
        setMsg($("#auth_msg"), e.message, false);
      }
    };

    // Nav
    document.querySelectorAll(".navbtn").forEach((b) => {
      b.onclick = () => setView(b.dataset.view);
    });

    // Buttons
    $("#btn_logout").onclick = hardLogout;
    $("#btn_refresh").onclick = refreshAll;
    $("#btn_create_visit").onclick = createVisit;

    $("#btn_load").onclick = loadSoc;
    $("#btn_save").onclick = saveSoc;
    $("#btn_generate").onclick = generateNote;
    $("#btn_sign").onclick = signAndLock;

    $("#btn_cal_load").onclick = loadCalendar;

    $("#btn_save_patient").onclick = savePatient;
    $("#btn_new_patient").onclick = newPatient;

    $("#btn_admin_setpass").onclick = adminSetPass;

    $("#btn_emergency").onclick = emergency;

    // Restore session
    const saved = localStorage.getItem(LS_TOKEN);
    if (saved) {
      state.token = saved;
      try {
        showApp();
        await doBootstrap();
        setView("visits");
      } catch (e) {
        // token invalid/expired -> force logout
        hardLogout();
        setMsg($("#auth_msg"), "Session expired. Please log in again.", false);
      }
    } else {
      showAuth();
    }

    // Render SOC shell (empty initially)
    renderSocForm($("#soc_form"));

    // mobile helper
    window.addEventListener("resize", onResize);
    onResize();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
