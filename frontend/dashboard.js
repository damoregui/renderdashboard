window.addEventListener("DOMContentLoaded", () => {
  // ====== Chart.js globals (texto blanco en leyendas/tooltips) ======
  if (window.Chart) {
    Chart.defaults.color = "#fff";
    if (Chart.defaults.plugins && Chart.defaults.plugins.legend && Chart.defaults.plugins.legend.labels) {
      Chart.defaults.plugins.legend.labels.color = "#fff";
    }
    if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
      Chart.defaults.plugins.tooltip.titleColor = "#fff";
      Chart.defaults.plugins.tooltip.bodyColor  = "#fff";
    }
  }

  let statusChart, dirChart;
  let _sentPending = 0;
  let _latestMetrics = null;
  let _segmentsAbs = 0;
  let _calendarEvents = [];
  let _calendarEventsStatusFilter = null;
  let _errorItems = [];
  let _activeErrorItem = null;
  let _userSummaries = [];
  let _isSuper = false;
  let _repeatData = [];
  let _repeatFrom = "";
  let _repeatTo = "";
  let _sentimentCache = new Map();
  let _tenantHasForm = false;
  let _activeTab = "sms";
  const _tenantFormSupport = new Map();
  const SORT_KEYS = ["replies","sentiment-asc","sentiment-desc"];
  const $ = (id) => document.getElementById(id);
  const datePickers = {};
  const errorBox = $("e");
  const from = $("from");
  const to = $("to");
  setupDatePickerElement(from);
  setupDatePickerElement(to);
  const loading = $("loading");
  const loadingNote = $("loadingNote");
  const defaultLoadingText = "Loading… Hold on tight.";
  const FORM_FIELD_COLUMNS = [
    { id: "2ZL13o2LQcC54KvXih3m", label: "Policy Status #1" },
    { id: "27h2x1pNm95Q7Y75hoST", label: "Insurance Provider #1" },
    { id: "D6RDbkPjIxCrKOp5M9Oz", label: "Plan Name #1" },
    { id: "T61ZX0M3kfxNloNtWItj", label: "Coverage Type #1" },
    { id: "wzQ2pzo1xXUl08CfQuAu", label: "Coverage Amount #1" },
    { id: "046SAY7OWHgegdclGgfm", label: "Coverage Length #1" },
    { id: "B1SaLltrM0Go3AuAMeHl", label: "Billing Frequency (Modal) #1" },
    { id: "KxD2iCYDJEAgCgUI6zy5", label: "Modal Premium ($) #1" },
    { id: "uPOMJUqI2DzNlKrCyNoG", label: "Annualized Premium ($) #1" },
    { id: "P4RjVrU0IfQNUfWSzRWU", label: "Applied Rating #1" },
    { id: "70FLn04r8zQQi0kFLSm0", label: "Number of Policies Sold" },
    { id: "XUhYbv85sUliPKvKw6wV", label: "Are you updating fields/Quoting or is this a NEW Sale" },
  ];
  const tenantWrap = $("tenantWrap");
  const tenantSelect = $("tenantSelect");
  const repeatSortSelect = $("repeatSort");
  const userMenuWrap = $("userMenuContainer");
  const userMenu = $("userMenu");
  const userMenuBtn = $("userMenuBtn");
  const userListContent = $("userListContent");
  const userListError = $("userListError");
  const userCreateForm = $("userCreateForm");
  const userCreateError = $("userCreateError");
  const userCreateRole = $("userCreateRole");
  const userEditForm = $("userEditForm");
  const userEditError = $("userEditError");
  const userEditRole = $("userEditRole");
  const userEditId = $("userEditId");
  const formsFrom = $("formsFrom");
  const formsTo = $("formsTo");
  const formsLoadBtn = $("formsLoad");
  const formsError = $("formsError");
  const formsResults = $("formsResults");
  const formsTableBody = $("formsTableBody");
  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  const smsTab = $("smsTab");
  const formsTab = $("formsTab");
  const formsTabBtn = $("formsTabBtn");
  const ingestFrom = $("ingestFrom");
  const ingestTo = $("ingestTo");
  const ingestError = $("ingestError");
  const ingestButton = $("ingestOpen");
  const runAllButton = $("runAllIngest");
  const errorsModalTitle = $("errorsModalTitle");
  const errorsModalSubtitle = $("errorsModalSubtitle");
  const errorsModalCount = $("errorsModalCount");
  const errorsModalList = $("errorsModalList");
  const errorsExportBtn = $("errorsExport");
  const errorsCloseBtn = $("errorsClose");
  let _repeatSort = sessionStorage.getItem("repeatSort") || "replies";
  if (!SORT_KEYS.includes(_repeatSort)) _repeatSort = "replies";
  if (repeatSortSelect){
    repeatSortSelect.value = _repeatSort;
    repeatSortSelect.addEventListener("change", () => {
      _repeatSort = repeatSortSelect.value || "replies";
      if (!SORT_KEYS.includes(_repeatSort)) _repeatSort = "replies";
      sessionStorage.setItem("repeatSort", _repeatSort);
      renderRepeatResponders(_repeatData, _repeatFrom, _repeatTo);
    });
  }
  if (ingestFrom) setupDatePickerElement(ingestFrom);
  if (ingestTo) setupDatePickerElement(ingestTo);
  if (formsFrom) setupDatePickerElement(formsFrom);
  if (formsTo) setupDatePickerElement(formsTo);
  if (ingestFrom && ingestTo){
    ingestFrom.addEventListener("change", () => {
      syncIngestRangeDefaults();
    });
    ingestTo.addEventListener("change", () => {
      syncIngestRangeDefaults();
    });
  }
  if (formsLoadBtn){
    formsLoadBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      loadForms();
    });
  }
  if (errorsCloseBtn){
    errorsCloseBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeErrorsModal();
    });
  }
  if (errorsExportBtn){
    errorsExportBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      exportActiveErrorsCsv();
    });
  }
  tabButtons.forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      setActiveTab(btn.dataset?.tab || "sms");
    });
  });
  let _availableDays = new Set();
  function setActiveTab(tab){
    const target = (tab === "forms" && _tenantHasForm) ? "forms" : "sms";
    _activeTab = target;
    tabButtons.forEach(btn => {
      const isMatch = (btn?.dataset?.tab) === target;
      if (isMatch || btn.classList.contains("active")){
        btn.classList.toggle("active", isMatch);
      }
    });
    if (smsTab) smsTab.classList.toggle("active", target === "sms");
    if (formsTab) formsTab.classList.toggle("active", target === "forms");
  }
  function updateFormsTabVisibility(hasForm){
    _tenantHasForm = Boolean(hasForm);
    if (formsTabBtn){
      formsTabBtn.style.display = _tenantHasForm ? "" : "none";
    }
    if (!_tenantHasForm && _activeTab === "forms"){
      setActiveTab("sms");
    }
  }
  function roundCurrency(val, decimals){
    if (!Number.isFinite(val)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round((val + Number.EPSILON) * factor) / factor;
  }
  function isValidDay(str){ return typeof str === "string" && /^\d{4}-\d{2}-\d{2}$/.test(str); }
  function formatYmdParts(year, month, day){ const mm=String(month+1).padStart(2,"0"); const dd=String(day).padStart(2,"0"); return `${year}-${mm}-${dd}`; }
  function parseYmdParts(str){ if (!isValidDay(str)) return null; const parts=str.split("-"); return { year:Number(parts[0]), month:Number(parts[1])-1, day:Number(parts[2]) }; }
  function refreshDatePickerIndicators(){ Object.keys(datePickers).forEach(id=>{ const picker=datePickers[id]; if(!picker||!picker.input) return; const val=(picker.input.value||"").trim(); if (val && _availableDays.has(val)){ picker.input.classList.remove("date-input-missing"); } else { picker.input.classList.add("date-input-missing"); } if(picker.isOpen){ renderDatePicker(picker); } }); }
  function changePickerMonth(picker, delta){ if(!picker) return; let y=typeof picker.viewYear==="number"?picker.viewYear:null; let m=typeof picker.viewMonth==="number"?picker.viewMonth:null; if(y==null||m==null){ const base=parseYmdParts(picker.input.value)||parseYmdParts(ymd(new Date())); y=base?base.year:new Date().getUTCFullYear(); m=base?base.month:new Date().getUTCMonth(); } m += delta; while(m < 0){ m += 12; y -= 1; } while(m > 11){ m -= 12; y += 1; } picker.viewYear=y; picker.viewMonth=m; renderDatePicker(picker); }
  function renderDatePicker(picker){ if(!picker||!picker.popup) return; if(typeof picker.viewYear!=="number"||typeof picker.viewMonth!=="number"){ const base=parseYmdParts(picker.input.value)||parseYmdParts(ymd(new Date())); picker.viewYear=base?base.year:new Date().getUTCFullYear(); picker.viewMonth=base?base.month:new Date().getUTCMonth(); } const year=picker.viewYear; const month=picker.viewMonth; const popup=picker.popup; popup.innerHTML=""; const header=document.createElement("div"); header.className="date-calendar-header"; const prev=document.createElement("button"); prev.type="button"; prev.textContent="‹"; prev.addEventListener("click", ev=>{ ev.stopPropagation(); changePickerMonth(picker,-1); }); const title=document.createElement("div"); title.className="date-calendar-title"; title.textContent=new Date(Date.UTC(year, month, 1)).toLocaleString("en-US", { month:"long", year:"numeric", timeZone:"UTC" }); const next=document.createElement("button"); next.type="button"; next.textContent="›"; next.addEventListener("click", ev=>{ ev.stopPropagation(); changePickerMonth(picker,1); }); header.appendChild(prev); header.appendChild(title); header.appendChild(next); popup.appendChild(header); const weekdays=document.createElement("div"); weekdays.className="date-weekdays"; ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(d=>{ const cell=document.createElement("div"); cell.textContent=d; weekdays.appendChild(cell); }); popup.appendChild(weekdays); const grid=document.createElement("div"); grid.className="date-grid"; const firstDow=new Date(Date.UTC(year, month, 1)).getUTCDay(); const daysInMonth=new Date(Date.UTC(year, month+1, 0)).getUTCDate(); const selected=parseYmdParts(picker.input.value); const total=Math.ceil((firstDow + daysInMonth)/7)*7; for(let i=0;i<firstDow;i++){ const blank=document.createElement("div"); blank.className="date-day empty"; grid.appendChild(blank); } for(let day=1; day<=daysInMonth; day++){ const dateKey=formatYmdParts(year, month, day); const btn=document.createElement("button"); btn.type="button"; let cls="date-day"; cls += _availableDays.has(dateKey) ? " has-data" : " no-data"; if(selected && selected.year===year && selected.month===month && selected.day===day){ cls += " selected"; } btn.className=cls; btn.textContent=String(day); btn.dataset.date=dateKey; btn.addEventListener("click", ev=>{ ev.stopPropagation(); picker.input.value=dateKey; closeAllDatePickers(); refreshDatePickerIndicators(); }); grid.appendChild(btn); } for(let extra = firstDow + daysInMonth; extra < total; extra++){ const blank=document.createElement("div"); blank.className="date-day empty"; grid.appendChild(blank); } popup.appendChild(grid); }
  function openDatePicker(id){ const picker=datePickers[id]; if(!picker) return; closeAllDatePickers(); const base=parseYmdParts(picker.input.value)||parseYmdParts(ymd(new Date())); picker.viewYear=base?base.year:new Date().getUTCFullYear(); picker.viewMonth=base?base.month:new Date().getUTCMonth(); picker.isOpen=true; renderDatePicker(picker); if(picker.popup) picker.popup.classList.add("open"); }
  function closeDatePicker(id){ const picker=datePickers[id]; if(!picker) return; picker.isOpen=false; if(picker.popup) picker.popup.classList.remove("open"); }
  function closeAllDatePickers(){ Object.keys(datePickers).forEach(id=>{ const picker=datePickers[id]; if(picker){ picker.isOpen=false; if(picker.popup) picker.popup.classList.remove("open"); } }); }
  function setupDatePickerElement(input){ if(!input || !input.id || datePickers[input.id]) return; input.setAttribute("readonly","readonly"); input.setAttribute("autocomplete","off"); const parent=input.parentNode; const wrap=document.createElement("div"); wrap.className="date-picker"; if(parent) parent.insertBefore(wrap, input); wrap.appendChild(input); const trigger=document.createElement("button"); trigger.type="button"; trigger.className="date-trigger"; trigger.setAttribute("aria-label","Open calendar"); trigger.textContent="▾"; wrap.appendChild(trigger); const popup=document.createElement("div"); popup.className="date-popup"; wrap.appendChild(popup); const id=input.id; const toggle=ev=>{ ev.stopPropagation(); const picker=datePickers[id]; if(picker && picker.isOpen){ closeDatePicker(id); } else { openDatePicker(id); } }; input.addEventListener("click", toggle); trigger.addEventListener("click", toggle); popup.addEventListener("click", ev=>ev.stopPropagation()); datePickers[id]={ input, wrapper:wrap, trigger, popup, isOpen:false, viewYear:null, viewMonth:null }; }
  function renderDirChartData(data){
    const wrap = document.getElementById("dirChartWrap");
    const canvas = document.getElementById("dirChart");
    if (!canvas) return;
    const dLabels = ["Outbound","Inbound"];
    const dData=[data?.outbound||0, data?.inbound||0];
    if (dirChart) { try{ dirChart.destroy(); }catch{} }
    dirChart = new Chart(canvas, {
      type: "doughnut",
      data: { labels: dLabels, datasets: [{ data: dData, backgroundColor: ["rgba(34, 197, 94, 0.81)","rgba(34, 121, 197, 0.81)"], borderColor: ["#ffffff","#ffffff"], borderWidth: 2, hoverOffset: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 18, boxHeight: 18, padding: 16,
              color: "white",
              font: { size: 24, weight: "700" },
              generateLabels: (chart) => {
                const ds = chart.data?.datasets?.[0] || {};
                const datasetData = ds.data || [];
                const labels = chart.data.labels || [];
                const bgc = ds.backgroundColor || [];
                const brc = ds.borderColor || [];
                return labels.map((label, i) => ({
                  text: label + ": " + (datasetData[i] ?? 0),
                  fillStyle: bgc[i] || "#999",
                  strokeStyle: brc[i] || "#fff",
                  lineWidth: ds.borderWidth ?? 1,
                  hidden: false,
                  index: i,
                  fontColor: "#fff"
                }));
              }
            }
          },
          tooltip: { enabled: true, titleColor:"#fff", bodyColor:"#fff" }
        }
      }
    });
    if (wrap) wrap.style.visibility = "visible";
  }
  async function loadAvailableDays(){
    const t = sessionStorage.getItem("authToken");
    if (!t){ _availableDays = new Set(); refreshDatePickerIndicators(); return; }
    try{
      const resp = await fetch("/api/date-availability", { headers: hdr(t) });
      const payload = await resp.json().catch(()=>({}));
      if (resp.ok && payload && Array.isArray(payload.days)){
        const next = new Set();
        payload.days.forEach(day => { if (isValidDay(day)) next.add(day); });
        _availableDays = next;
      } else {
        _availableDays = new Set();
      }
    }catch(_){
      _availableDays = new Set();
    }
    refreshDatePickerIndicators();
  }
  async function refreshFormsMeta(){
    const t = sessionStorage.getItem("authToken");
    if (!t){ updateFormsTabVisibility(false); return; }
    try{
      const resp = await fetch("/api/forms-submissions?meta=1", { headers: hdr(t) });
      const payload = await resp.json().catch(() => ({}));
      if (resp.ok && typeof payload?.hasForm !== "undefined"){
        updateFormsTabVisibility(Boolean(payload.hasForm));
        return;
      }
      if (resp.status === 400 && payload?.error === "missing_form_id"){
        updateFormsTabVisibility(false);
        return;
      }
    }catch(_){ }
    updateFormsTabVisibility(_tenantHasForm);
  }
  function hdr(t){ const h={}; if(t){ h["authorization"]="Bearer " + t; } const o=sessionStorage.getItem("tenantOverride"); if(o) h["x-tenant-override"]=o; return h; }

  function ymd(d){ const yyyy=d.getUTCFullYear(); const mm=String(d.getUTCMonth()+1).padStart(2,"0"); const dd=String(d.getUTCDate()).padStart(2,"0"); return yyyy+"-"+mm+"-"+dd; }
  const token = sessionStorage.getItem("authToken") || new URL(location.href).searchParams.get("t");
  if (token) sessionStorage.setItem("authToken", token);
  if (from && to){ const y=new Date(Date.now()-86400000); from.value=ymd(y); to.value=ymd(y); refreshDatePickerIndicators(); if (formsFrom && formsTo){ formsFrom.value=ymd(y); formsTo.value=ymd(y); refreshDatePickerIndicators(); } }

  function fmtTsISO(iso){ try{ const d=new Date(iso); return d.toISOString().replace("T"," ").replace(".000Z","Z"); }catch{ return iso||"" } }
  function trimTime(time){
    if(!time) return "";
    let r = String(time).trim();
    const dot = r.indexOf(".");
    if(dot !== -1) r = r.slice(0, dot);
    r = r.replace(/Z$/i, "");
    r = r.replace(/([+-]\d{2}:?\d{2})$/, "");
    return r;
  }
  function fmtDateOnly(iso){
    if(!iso) return "";
    try{
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toISOString().split("T")[0];
    }catch(_){ return String(iso||""); }
  }
  function fmtTsLines(iso){
    if(!iso) return null;
    try{
      const d=new Date(iso);
      if(!Number.isNaN(d.getTime())){
        const [datePart, timePartRaw] = d.toISOString().split("T");
        const timePart = timePartRaw ? trimTime(timePartRaw) : "";
        return { date: datePart, time: timePart };
      }
    }catch(_){}
    if(typeof iso === "string"){
      const cleaned = iso.trim().replace("T", " ");
      const parts = cleaned.split(/\s+/);
      const date = parts[0] || cleaned;
      const time = trimTime(parts[1] || "");
      return { date, time };
    }
    return null;
  }
  function fmtDateOnly(iso){
    if(!iso) return null;
    const parts = fmtTsLines(iso);
    if(parts && parts.date) return parts.date;
    if(typeof iso === "string"){
      const cleaned = iso.trim();
      if(!cleaned) return null;
      const normalized = cleaned.replace("T", " ");
      const chunk = normalized.split(/\s+/)[0];
      return chunk || normalized;
    }
    return null;
  }
  function formatEventStatus(status){
    const raw = (status == null ? "" : String(status)).trim();
    const normalized = raw ? raw.replace(/_/g, " ") : "unknown";
    if (normalized.toLowerCase() === "noshow") return "No show";
    if (normalized.toLowerCase() === "no show") return "No show";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  function esc(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function csvEscape(value){
    if (value === undefined || value === null) return "";
    let str;
    if (typeof value === "string"){
      str = value;
    } else {
      try {
        str = JSON.stringify(value);
      } catch {
        str = String(value);
      }
    }
    return '"' + str.replace(/"/g, '""') + '"';
  }

  async function initTenantDropdown(){
    _calendarEvents = [];
    _sentimentCache = new Map();
    _repeatData = [];
    try{
      const t = sessionStorage.getItem("authToken"); if(!t){ setSuperMode(false); return; }
      const r = await fetch("/api/tenants", { headers: hdr(t) });
      if (!r.ok){ if (tenantWrap) tenantWrap.style.display = "none"; setSuperMode(false); return; }
      const j = await r.json().catch(()=>({}));
      if (!j.ok || !Array.isArray(j.tenants) || !j.tenants.length){ if (tenantWrap) tenantWrap.style.display = "none"; setSuperMode(false); return; }
      if (tenantWrap) tenantWrap.style.display = "";
      setSuperMode(true);
      if (tenantSelect){
        tenantSelect.innerHTML = "";
        const opt0=document.createElement("option"); opt0.value=""; opt0.textContent="(Choose tenant)"; tenantSelect.appendChild(opt0);
        _tenantFormSupport.clear();
        j.tenants.forEach(x=>{
          const hasForm = Boolean(x?.hasForm);
          if (x?.tenantId) _tenantFormSupport.set(x.tenantId, hasForm);
          const o=document.createElement("option");
          o.value=x.tenantId;
          o.textContent=x.name||x.tenantId;
          o.dataset.hasForm = hasForm ? "true" : "false";
          o.dataset.formId = x?.formId || "";
          tenantSelect.appendChild(o);
        });
        let saved=sessionStorage.getItem("tenantOverride")||"";
        if (!saved || !j.tenants.some(x => x && x.tenantId === saved)){ saved = j.tenants[0]?.tenantId || ""; if (saved) sessionStorage.setItem("tenantOverride", saved); }
        if (saved) tenantSelect.value=saved;
        _tenantHasForm = _tenantFormSupport.get(saved) || false;
        updateFormsTabVisibility(_tenantHasForm);
        if (!tenantSelect._listenerAttached){ tenantSelect.addEventListener("change", ()=>{ const v=tenantSelect.value||""; sessionStorage.setItem("tenantOverride", v); _tenantHasForm = _tenantFormSupport.get(v) || false; updateFormsTabVisibility(_tenantHasForm); loadMetrics(); }); tenantSelect._listenerAttached = true; }
      }
    }catch(_){ if (tenantWrap) tenantWrap.style.display = "none"; setSuperMode(false); }
  }
  
  async function loadMetrics(){
    if (!errorBox) return;
    errorBox.textContent = "";
    closeAllDatePickers();
    const t = sessionStorage.getItem("authToken");
    if (!t){ errorBox.textContent = "No token. Go back to / and login."; return; }
    if (!from || !to){ errorBox.textContent = "Missing date inputs in DOM."; return; }
    const f = (from.value||"").trim();
    const tt = (to.value||"").trim();
    if (!f || !tt){ errorBox.textContent = "Pick dates."; return; }
    const loadingMsg = "Loading… Hold on tight.";
    setLoading(true, loadingMsg);
    _calendarEvents = [];
    try{
      await loadAvailableDays();
      await refreshFormsMeta();
      const r = await fetch("/api/metrics?from=" + f + "&to=" + tt, { headers: hdr(t) });
      const data = await r.json();
      if (!r.ok){ throw new Error((data && data.error) || "metrics_failed"); }
      _latestMetrics = data;
      const setNum = (id,val)=>{ const el=$(id); if (el) el.textContent = (typeof val==="number") ? val : (val||0); };
      setNum("segments", data.sumSegments);
      setNum("stopCount", data.stopCount);
      (function(){
        const curM = (data.currency || data.priceCurrency || data.totalPriceCurrency || "USD").toUpperCase();
        const raw = Number(data.totalPriceAbs || 0);
        const n = Number.isFinite(raw) ? raw : 0;
        const decimals = curM === "USD" ? 2 : 6;
        const rounded = roundCurrency(n, decimals);
        _segmentsAbs = rounded;
        const out = Number.isFinite(rounded)
          ? rounded.toFixed(decimals)
          : (decimals === 2 ? "0.00" : "0.000000");
        const el = $("priceAbs"); if (el) el.textContent = out;
        const curEl = $("priceAbsCur"); if (curEl) curEl.textContent = curM;
      })();
      setNum("uniqueProspectsTotal", data.uniqueProspectsTotal);
      setNum("totalMsgs", (typeof data.total==="number") ? data.total : (data.outbound||0)+(data.inbound||0));
      setNum("calendarEventsCount", data.calendarEventsCount);
      _calendarEvents = Array.isArray(data.calendarEvents) ? data.calendarEvents : [];
      _repeatData = Array.isArray(data.repeatResponders) ? data.repeatResponders.map(r => ({ ...r })) : [];
      _repeatFrom = f;
      _repeatTo = tt;
      renderRepeatResponders(_repeatData, f, tt);

      // Charts
      try{
        const sLabels = Object.keys(data.byStatus || {});
        const sData   = sLabels.map(k => data.byStatus[k]);
        if (statusChart) statusChart.destroy();
        if ($("statusChart")){
          statusChart = new Chart($("statusChart"), {
            type: "bar",
            data: { labels: sLabels, datasets: [{ data: sData }] },
            options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } }
          });
        }
        if ($("dirChart")){ _latestMetrics = data; if (_sentPending === 0) { renderDirChartData(data); } }
      }catch(_){}

      // Errors
      try{
        const er = await fetch("/api/errors?from=" + f + "&to=" + tt, { headers: hdr(t) });
        const ej = await er.json();
        if (er.ok && ej.ok){ renderErrorsCards(ej.items||[]); } else { renderErrorsCards([]); }
      }catch{ renderErrorsCards([]); }

      // Usage-day (costos)
      await loadUsageDayCosts(f, tt, t);

      if (repeatSortSelect){ repeatSortSelect.value = _repeatSort; }
    }catch(e){ errorBox.textContent = e.message || "Failed to load metrics."; }
    finally {
      setLoading(false);
    }
  }

  function renderErrorsCards(items){
    const card = $("errorsCard"); const grid = $("errorsGrid"); if (!card || !grid) return;
    grid.innerHTML = "";
    _activeErrorItem = null;
    if (!Array.isArray(items) || !items.length){
      _errorItems = [];
      card.style.display = "none";
      if (errorsModalList) errorsModalList.innerHTML = "";
      if (errorsModalTitle) errorsModalTitle.textContent = "";
      if (errorsModalSubtitle) errorsModalSubtitle.textContent = "";
      if (errorsModalCount) errorsModalCount.textContent = "";
      if (errorsExportBtn) errorsExportBtn.disabled = true;
      return;
    }
    _errorItems = items.map(item => {
      const details = Array.isArray(item.details) ? item.details.map(d => ({ ...d })) : [];
      const count = typeof item.count === "number" ? item.count : details.length;
      return { ...item, count, details };
    });
    const sorted = _errorItems.slice().sort((a,b)=> (b.count||0)-(a.count||0));
    card.style.display = "";
    sorted.forEach(it => {
      const c = document.createElement("div");
      c.className = "card card-click";
      c.tabIndex = 0;
      const num = document.createElement("div");
      num.className = "num";
      num.textContent = it.count || 0;
      const cap = document.createElement("div");
      cap.className = "muted";
      cap.textContent = "Code " + (it.code || "?");
      const desc = document.createElement("div");
      desc.className = "muted";
      desc.style.fontSize = "12px";
      desc.textContent = it.description || "See Twilio docs";
      const hint = document.createElement("div");
      hint.className = "muted";
      hint.style.fontSize = "11px";
      hint.textContent = "Click to view affected contacts";
      c.appendChild(num);
      c.appendChild(cap);
      c.appendChild(desc);
      c.appendChild(hint);
      c.addEventListener("click", (ev) => {
        ev.preventDefault();
        openErrorsModalByCode(it.code);
      });
      c.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " "){
          ev.preventDefault();
          openErrorsModalByCode(it.code);
        }
      });
      grid.appendChild(c);
    });
  }

  function openErrorsModalByCode(code){
    if (!_errorItems.length) return;
    const target = _errorItems.find(item => String(item.code) === String(code));
    if (!target) return;
    _activeErrorItem = target;
    renderErrorsModal(target);
    showModal("errorsModal");
  }

  function renderErrorsModal(item){
    if (!item){
      if (errorsModalTitle) errorsModalTitle.textContent = "";
      if (errorsModalSubtitle) errorsModalSubtitle.textContent = "";
      if (errorsModalCount) errorsModalCount.textContent = "";
      if (errorsModalList) errorsModalList.innerHTML = "";
      if (errorsExportBtn) errorsExportBtn.disabled = true;
      return;
    }
    const details = Array.isArray(item.details) ? item.details : [];
    const detailCount = details.length;
    if (errorsModalTitle) errorsModalTitle.textContent = item.code ? `Code ${item.code}` : "Twilio error";
    if (errorsModalSubtitle) errorsModalSubtitle.textContent = item.description || "See Twilio docs";
    if (errorsModalCount){
      errorsModalCount.textContent = detailCount
        ? `${detailCount} message${detailCount === 1 ? "" : "s"} with this error`
        : "No message details available for this error code.";
    }
    if (errorsModalList){
      errorsModalList.innerHTML = "";
      if (!detailCount){
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No message details available for this error code.";
        errorsModalList.appendChild(empty);
      } else {
        details.forEach(detail => {
          const wrap = document.createElement("details");
          wrap.className = "error-detail";
          const summary = document.createElement("summary");
          const summaryParts = [];
          if (detail.to) summaryParts.push(detail.to);
          if (detail.status) summaryParts.push(detail.status);
          if (detail.sid) summaryParts.push(detail.sid);
          summary.textContent = summaryParts.length ? summaryParts.join(" • ") : "View details";
          wrap.appendChild(summary);

          const meta = document.createElement("div");
          meta.className = "error-meta";
          const metaEntries = [];
          if (detail.sid) metaEntries.push({ label: "SID", value: detail.sid });
          if (detail.from) metaEntries.push({ label: "From", value: detail.from });
          if (detail.direction) metaEntries.push({ label: "Direction", value: detail.direction });
          if (detail.messagingServiceSid) metaEntries.push({ label: "Messaging SID", value: detail.messagingServiceSid });
          if (detail.numSegments != null) metaEntries.push({ label: "Segments", value: detail.numSegments });
          if (detail.price != null){
            const priceLabel = detail.priceUnit ? `${detail.price} ${detail.priceUnit}` : String(detail.price);
            metaEntries.push({ label: "Price", value: priceLabel });
          }
          if (detail.dateSentUtc){
            const sentParts = fmtTsLines(detail.dateSentUtc);
            const sentLabel = sentParts ? [sentParts.date, sentParts.time].filter(Boolean).join(" ") : detail.dateSentUtc;
            metaEntries.push({ label: "Date sent", value: sentLabel });
          }
          if (detail.updatedAt){
            const updParts = fmtTsLines(detail.updatedAt);
            const updLabel = updParts ? [updParts.date, updParts.time].filter(Boolean).join(" ") : detail.updatedAt;
            metaEntries.push({ label: "Updated", value: updLabel });
          }
          if (detail.errorMessage) metaEntries.push({ label: "Error", value: detail.errorMessage });
          metaEntries.forEach(entry => {
            const span = document.createElement("span");
            span.textContent = `${entry.label}: ${entry.value}`;
            meta.appendChild(span);
          });
          if (metaEntries.length) wrap.appendChild(meta);

          if (detail.body){
            const body = document.createElement("div");
            body.className = "error-body";
            body.textContent = detail.body;
            wrap.appendChild(body);
          }

          const pre = document.createElement("pre");
          pre.className = "error-json";
          const payload = detail.twilioPayload || detail;
          let payloadText = "";
          try {
            payloadText = JSON.stringify(payload, null, 2);
          } catch {
            payloadText = String(payload);
          }
          pre.textContent = payloadText;
          wrap.appendChild(pre);

          errorsModalList.appendChild(wrap);
        });
      }
    }
    if (errorsExportBtn) errorsExportBtn.disabled = !detailCount;
  }

  function closeErrorsModal(){
    hideModal("errorsModal");
    _activeErrorItem = null;
  }

  function exportActiveErrorsCsv(){
    if (!_activeErrorItem || !Array.isArray(_activeErrorItem.details) || !_activeErrorItem.details.length) return;
    const headers = ["sid","to","from","status","direction","dateSentUtc","body","errorCode","errorMessage","price","priceUnit","numSegments","messagingServiceSid","updatedAt","twilioPayload"];
    const rows = [headers.map(csvEscape).join(",")];
    _activeErrorItem.details.forEach(detail => {
      const payload = detail.twilioPayload || detail;
      let payloadJson = "";
      try {
        payloadJson = JSON.stringify(payload);
      } catch {
        payloadJson = String(payload);
      }
      const values = [
        detail.sid ?? "",
        detail.to ?? "",
        detail.from ?? "",
        detail.status ?? "",
        detail.direction ?? "",
        detail.dateSentUtc ?? "",
        detail.body ?? "",
        detail.errorCode ?? "",
        detail.errorMessage ?? "",
        detail.price ?? "",
        detail.priceUnit ?? "",
        detail.numSegments ?? "",
        detail.messagingServiceSid ?? "",
        detail.updatedAt ?? "",
        payloadJson
      ];
      rows.push(values.map(csvEscape).join(","));
    });
    const csv = rows.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date().toISOString().split("T")[0];
    a.download = `twilio-error-${_activeErrorItem.code || "unknown"}-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function clearUsageCards(msg){
    const ids=[
      "mmsTotalCost","totalFeesMmsLookups",
      "smsCarrierFees","mmsCarrierFees","carrierFeesTotal","lookupsCost",
      "mmsTotalCur","smsCarrierCur","mmsCarrierCur","carrierFeesCur","lookupsCur","totalFeesMmsLookupsCur"
    ];
    ids.forEach(id=>{ const el=$(id); if(el){ el.textContent="—"; if(msg) el.title=msg; }});
  }

  function setSuperMode(enabled){
    _isSuper = !!enabled;
    if (userMenuWrap) userMenuWrap.style.display = enabled ? "" : "none";
    if (ingestButton) ingestButton.style.display = enabled ? "" : "none";
    if (runAllButton) runAllButton.style.display = enabled ? "" : "none";
    if (!enabled) closeUserMenu();
  }

  function openUserMenu(){ if (userMenu) userMenu.classList.add("open"); }
  function closeUserMenu(){ if (userMenu) userMenu.classList.remove("open"); }
  function toggleUserMenu(){ if (!userMenu) return; if (userMenu.classList.contains("open")) closeUserMenu(); else openUserMenu(); }

  function updateRoleSections(form, role){
    if (!form) return;
    const target = (role || "owner").toLowerCase();
    const isOwner = target === "owner";
    form.querySelectorAll("[data-role-section]").forEach(section => {
      const secRole = (section.getAttribute("data-role-section") || "").toLowerCase();
      section.style.display = secRole && secRole !== "owner" ? "" : (isOwner ? "" : "none");
    });
    form.querySelectorAll("[data-role-field]").forEach(input => {
      const roleKey = (input.getAttribute("data-role-field") || "").toLowerCase();
      input.disabled = roleKey === "owner" ? !isOwner : false;
    });
  }

  function getUserFormData(form){
    const out = {};
    if (!form) return out;
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()){
      if (typeof value === "string"){
        out[key] = key === "password" ? value : value.trim();
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  async function loadUserSummaries(){
    const token = sessionStorage.getItem("authToken");
    if (!token) throw new Error("missing_token");
    const r = await fetch("/api/users", { headers: hdr(token) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) throw new Error((j && j.error) || "users_fetch_failed");
    _userSummaries = Array.isArray(j.users) ? j.users : [];
    return _userSummaries;
  }

  function renderUserList(users){
    if (!userListContent) return;
    userListContent.innerHTML = "";
    if (!Array.isArray(users) || !users.length){
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.padding = "8px";
      empty.textContent = "No users found.";
      userListContent.appendChild(empty);
      return;
    }
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Tenant","Role","Actions"].forEach(label => {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    users.forEach(user => {
      const tr = document.createElement("tr");
      const tdTenant = document.createElement("td");
      const tenantLabel = user.tenantName || user.tenantId || "—";
      tdTenant.textContent = tenantLabel;
      if (user.username){
        const sub = document.createElement("div");
        sub.className = "muted";
        sub.style.fontSize = "12px";
        sub.textContent = user.username;
        tdTenant.appendChild(sub);
      }
      tr.appendChild(tdTenant);
      const tdRole = document.createElement("td"); tdRole.textContent = (user.role || "owner").toLowerCase(); tr.appendChild(tdRole);
      const tdAction = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Edit";
      btn.style.background = "rgba(255,255,255,.08)";
      btn.style.border = "1px solid rgba(255,255,255,.12)";
      btn.style.borderRadius = "8px";
      btn.style.padding = "6px 10px";
      btn.dataset.userId = user.id;
      tdAction.appendChild(btn);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    userListContent.appendChild(table);
  }

  async function openUserListModal(){
    closeUserMenu();
    if (userListError) userListError.textContent = "";
    if (userListContent){
      userListContent.innerHTML = "";
      const loadingMsg = document.createElement("div");
      loadingMsg.className = "muted";
      loadingMsg.style.padding = "8px";
      loadingMsg.textContent = "Loading…";
      userListContent.appendChild(loadingMsg);
    }
    showModal("userListModal");
    try{
      const list = await loadUserSummaries();
      renderUserList(list);
    }catch(err){
      if (userListContent) userListContent.innerHTML = "";
      if (userListError) userListError.textContent = err?.message || "Failed to load users.";
    }
  }

  function closeUserListModal(){ hideModal("userListModal"); }

  function openCreateUserModal(){
    closeUserMenu();
    if (userCreateError) userCreateError.textContent = "";
    if (userCreateForm){
      userCreateForm.reset();
      if (userCreateRole) userCreateRole.value = userCreateRole.options && userCreateRole.options.length ? userCreateRole.options[0].value : "owner";
      const role = userCreateRole ? (userCreateRole.value || "owner") : "owner";
      updateRoleSections(userCreateForm, role);
    }
    showModal("userCreateModal");
  }

  function closeCreateUserModal(){ hideModal("userCreateModal"); }

  async function submitCreateUser(ev){
    ev.preventDefault();
    if (!userCreateForm) return;
    if (userCreateError) userCreateError.textContent = "";
    const data = getUserFormData(userCreateForm);
    const role = (data.role || "owner").toLowerCase();
    const payload = { username: data.username || "", password: data.password || "", role };
    if (!payload.username){ if (userCreateError) userCreateError.textContent = "Username is required."; return; }
    if (!payload.password){ if (userCreateError) userCreateError.textContent = "Password is required."; return; }
    if (role === "owner"){
      if (!data.tenantName || !data.twilioAccountSid || !data.twilioAuthToken || !data.ghlLocationId || !data.ghlApiKey){
        if (userCreateError) userCreateError.textContent = "All tenant fields are required for owners.";
        return;
      }
      payload.tenantName = data.tenantName;
      payload.twilioAccountSid = data.twilioAccountSid;
      payload.twilioAuthToken = data.twilioAuthToken;
      payload.ghlLocationId = data.ghlLocationId;
      payload.ghlApiKey = data.ghlApiKey;
      if (data.ghlAlias) payload.ghlAlias = data.ghlAlias;
      if (data.calendarId) payload.calendarId = data.calendarId;
      if (data.formId) payload.formId = data.formId;
    }
    try{
      setLoading(true);
      const token = sessionStorage.getItem("authToken");
      if (!token) throw new Error("missing_token");
      const headers = hdr(token);
      headers["content-type"] = "application/json";
      const r = await fetch("/api/users", { method:"POST", headers, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error((j && j.error) || "create_failed");
      closeCreateUserModal();
      await openUserListModal();
    }catch(err){
      if (userCreateError) userCreateError.textContent = err?.message || "Failed to create user.";
    }finally{ setLoading(false); }
  }

  async function openEditUserModal(userId){
    closeUserMenu();
    if (!userId){ return; }
    if (userEditError) userEditError.textContent = "";
    const token = sessionStorage.getItem("authToken");
    if (!token){ if (userEditError) userEditError.textContent = "Missing token."; return; }
    if (userEditForm) userEditForm.reset();
    showModal("userEditModal");
    try{
      const headers = hdr(token);
      const r = await fetch(`/api/users?id=${encodeURIComponent(userId)}`, { headers });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error((j && j.error) || "load_failed");
      const detail = j.user || {};
      if (userEditId) userEditId.value = detail.id || userId;
      if (userEditForm){
        const el = userEditForm.elements;
        if (el.username) el.username.value = detail.username || "";
        if (el.role) el.role.value = (detail.role || "owner").toLowerCase();
        if (el.tenantName) el.tenantName.value = detail.tenantName || "";
        if (el.twilioAccountSid) el.twilioAccountSid.value = detail.twilioAccountSid || "";
        if (el.twilioAuthToken) el.twilioAuthToken.value = detail.twilioAuthToken || "";
        if (el.ghlLocationId) el.ghlLocationId.value = detail.ghlLocationId || "";
        if (el.ghlApiKey) el.ghlApiKey.value = detail.ghlApiKey || "";
        if (el.ghlAlias) el.ghlAlias.value = detail.ghlAlias || "";
        if (el.calendarId) el.calendarId.value = detail.calendarId || "";
        if (el.formId) el.formId.value = detail.formId || "";
        const roleVal = el.role ? (el.role.value || "owner") : "owner";
        updateRoleSections(userEditForm, roleVal);
      }
    }catch(err){
      if (userEditError) userEditError.textContent = err?.message || "Failed to load user.";
    }
  }

  function closeEditUserModal(){ hideModal("userEditModal"); }

  async function submitEditUser(ev){
    ev.preventDefault();
    if (!userEditForm) return;
    if (userEditError) userEditError.textContent = "";
    const data = getUserFormData(userEditForm);
    const payload = { userId: data.userId || data.id };
    if (!payload.userId){ if (userEditError) userEditError.textContent = "Missing user id."; return; }
    if (data.username) payload.username = data.username;
    if (data.password) payload.password = data.password;
    if (data.role) payload.role = data.role.toLowerCase();
    if (data.tenantName) payload.tenantName = data.tenantName;
    if (data.twilioAccountSid) payload.twilioAccountSid = data.twilioAccountSid;
    if (data.twilioAuthToken) payload.twilioAuthToken = data.twilioAuthToken;
    if (data.ghlLocationId) payload.ghlLocationId = data.ghlLocationId;
    if (data.ghlApiKey) payload.ghlApiKey = data.ghlApiKey;
    if (data.ghlAlias !== undefined) payload.ghlAlias = data.ghlAlias;
    if (data.calendarId !== undefined) payload.calendarId = data.calendarId;
    if (data.formId !== undefined) payload.formId = data.formId;
    try{
      setLoading(true);
      const token = sessionStorage.getItem("authToken");
      if (!token) throw new Error("missing_token");
      const headers = hdr(token);
      headers["content-type"] = "application/json";
      const r = await fetch("/api/users", { method:"PUT", headers, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error((j && j.error) || "update_failed");
      closeEditUserModal();
      await openUserListModal();
    }catch(err){
      if (userEditError) userEditError.textContent = err?.message || "Failed to update user.";
    }finally{ setLoading(false); }
  }

  function compareRepeatReplies(a,b){
    const diff = (Number(b?.count)||0) - (Number(a?.count)||0);
    if (diff !== 0) return diff;
    const nameA = `${a?.firstName||""} ${a?.lastName||""}`.trim().toLowerCase();
    const nameB = `${b?.firstName||""} ${b?.lastName||""}`.trim().toLowerCase();
    if (nameA && nameB){
      const cmp = nameA.localeCompare(nameB);
      if (cmp !== 0) return cmp;
    }
    const phoneA = String(a?.phone||"");
    const phoneB = String(b?.phone||"");
    return phoneA.localeCompare(phoneB);
  }

  function sortRepeatResponders(rows){
    const arr = Array.isArray(rows) ? rows.slice() : [];
    if (arr.length <= 1) return arr;
    if (_repeatSort === "sentiment-asc" || _repeatSort === "sentiment-desc"){
      const dir = _repeatSort === "sentiment-asc" ? 1 : -1;
      arr.sort((a,b) => {
        const sa = String(a?.sentiment||"").toLowerCase();
        const sb = String(b?.sentiment||"").toLowerCase();
        const hasA = !!sa;
        const hasB = !!sb;
        if (hasA && !hasB) return -1;
        if (!hasA && hasB) return 1;
        if (!hasA && !hasB) return compareRepeatReplies(a,b);
        const cmp = sa.localeCompare(sb);
        if (cmp !== 0) return dir === 1 ? cmp : -cmp;
        return compareRepeatReplies(a,b);
      });
      return arr;
    }
    arr.sort(compareRepeatReplies);
    return arr;
  }

  async function loadUsageDayCosts(f, tt, token){
    try{
      if (!f || !tt){ clearUsageCards(); return; }
      const r = await fetch(`/api/usage-day?from=${encodeURIComponent(f)}&to=${encodeURIComponent(tt)}`, { headers: hdr(token) });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error((j && (j.detail||j.error)) || "usage_failed");
      const cur = (j.currency || "USD").toUpperCase();
      const setMoney = (id, val) => {
        const el = $(id); if (!el) return;
        const decimals = cur === "USD" ? 2 : 6;
        const n = Number(val || 0);
        if (!Number.isFinite(n)) {
          el.textContent = decimals === 2 ? "0.00" : "0.000000";
          return;
        }
        const rounded = roundCurrency(n, decimals);
        el.textContent = rounded.toFixed(decimals);
      };
      setMoney("mmsTotalCost", j.mms?.total);
      setMoney("smsCarrierFees", j.carrierFees?.sms);
      setMoney("mmsCarrierFees", j.carrierFees?.mms);
      setMoney("carrierFeesTotal", j.carrierFees?.total);
      setMoney("lookupsCost", j.lookups?.total);
      const baseCombined = Number(j.overall?.feesMmsLookups || 0);
      const segAdd = Number.isFinite(_segmentsAbs) ? _segmentsAbs : 0;
      setMoney("totalFeesMmsLookups", baseCombined + segAdd);
      ["mmsTotalCur","smsCarrierCur","mmsCarrierCur","carrierFeesCur","lookupsCur","totalFeesMmsLookupsCur"].forEach(id=>{ const el=$(id); if(el) el.textContent = cur; });
    }catch(e){ clearUsageCards(e?.message||"usage_failed"); }
  }

  function setLoading(v, note){
    document.body.style.pointerEvents = v ? "none" : "auto";
    document.body.style.opacity = v ? .7 : 1;
    if (loading) loading.style.display = v ? "grid" : "none";
    if (loadingNote){
      if (v){
        loadingNote.textContent = note || defaultLoadingText;
      } else {
        loadingNote.textContent = defaultLoadingText;
      }
    }
  }

  async function refreshToken(){ const t = sessionStorage.getItem("authToken"); if (!t) return; try{ const r = await fetch("/api/refresh", { method:"POST", headers: hdr(t) }); const j = await r.json().catch(()=>({})); if (r.ok && j.ok && j.token) sessionStorage.setItem("authToken", j.token); }catch{} }
  setInterval(refreshToken, 10 * 60 * 1000);

  function paintSentiment(badge, value){ const v = (value||"").toLowerCase(); badge.textContent = v || "—"; badge.className = "badge " + (v === "positive" ? "positive" : (v === "negative" ? "negative" : "neutral")); }
  function updateRepeatSentiment(phone, sentiment){ if(!_repeatData || !_repeatData.length || !phone) return; for(let i=0;i<_repeatData.length;i++){ const item=_repeatData[i]; if(item && item.phone===phone){ _repeatData[i] = { ...item, sentiment }; break; } } }
  async function hydrateSentiment(phone, fromDay, toDay, badge){ const cacheKey = phone ? [phone, fromDay, toDay].join("|") : null; if (cacheKey && _sentimentCache.has(cacheKey)){ const cached=_sentimentCache.get(cacheKey); if (cached) paintSentiment(badge, cached); return; } const t = sessionStorage.getItem("authToken"); if (!t) return; try{ const r = await fetch("/api/responder?phone="+encodeURIComponent(phone)+"&from="+encodeURIComponent(fromDay)+"&to="+encodeURIComponent(toDay), { headers: hdr(t) }); const j = await r.json().catch(()=>({})); if (r.ok && j && j.ok){ const val = j.sentiment || ""; if (val) paintSentiment(badge, val); if (cacheKey) _sentimentCache.set(cacheKey, val); updateRepeatSentiment(phone, val); } }catch(_){} }

  function renderRepeatResponders(rr, f, tt){
    const box = $("repeatResponders"); if (!box) return; box.innerHTML = "";
    _sentPending = 0;
    const rows = sortRepeatResponders(rr || []);
    if (!rows.length){ const em=document.createElement("div"); const __w = document.getElementById("dirChartWrap"); if (__w) __w.style.visibility="hidden"; em.className="muted"; em.textContent="No responders in range."; box.appendChild(em); return; }
    const table=document.createElement("table");
    table.className = "repeat-table";
    const thead=document.createElement("thead"); const trh=document.createElement("tr");
    ["Phone","Replies","Sentiment"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; trh.appendChild(th);}); thead.appendChild(trh); table.appendChild(thead);
    const tbody=document.createElement("tbody"); table.appendChild(tbody);
    rows.forEach((row,i)=>{
      const tr=document.createElement("tr"); tr.className="expander"; tr.dataset.phone=row.phone;
      const td1=document.createElement("td");
      const name = (row.firstName || row.lastName) ? ((row.firstName||"") + " " + (row.lastName||"")).trim() : null;
      const label = name || (row.phone || "(unknown)");
      if (row.ghlUrl) { const a=document.createElement("a"); a.href=row.ghlUrl; a.target="_blank"; a.rel="noreferrer"; a.textContent=label; a.style.color="#fff"; a.style.textDecoration="none"; td1.appendChild(a); if (name){ const sub=document.createElement("div"); sub.className="muted"; sub.textContent=row.phone||""; td1.appendChild(sub); } }
      else { td1.textContent = label; }
      const td2=document.createElement("td"); td2.textContent=row.count; td2.style.textAlign="right";
      const td3=document.createElement("td"); td3.style.textAlign="right"; const badge=document.createElement("span"); badge.className="badge neutral"; badge.textContent="—"; td3.appendChild(badge);
      const cacheKey = row.phone ? [row.phone, f, tt].join("|") : null;
      if (cacheKey && _sentimentCache.has(cacheKey)){
        const cached = _sentimentCache.get(cacheKey);
        if (cached) paintSentiment(badge, cached);
      } else if (row.sentiment){
        paintSentiment(badge, row.sentiment);
        if (cacheKey) _sentimentCache.set(cacheKey, row.sentiment);
      }
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tbody.appendChild(tr);

      const trMsg=document.createElement("tr"); trMsg.style.display="none"; const tdMsg=document.createElement("td"); tdMsg.colSpan=3; tdMsg.style.padding="0 8px 8px";
      const holder=document.createElement("div"); holder.className="messages"; holder.textContent=""; tdMsg.appendChild(holder); trMsg.appendChild(tdMsg); tbody.appendChild(trMsg);
      let loaded=false, open=false;
      tr.addEventListener("click", async ()=>{
        open=!open; trMsg.style.display=open?"":"none";
        if (!loaded && open){
          holder.textContent="Loading...";
          try{
            const t=sessionStorage.getItem("authToken");
            const url="/api/responder?phone="+encodeURIComponent(row.phone)+"&from="+encodeURIComponent(f)+"&to="+encodeURIComponent(tt);
            const r=await fetch(url,{ headers: hdr(t) }); const j=await r.json(); if(!r.ok||!j.ok) throw new Error((j&&j.error)||"fetch_failed");
            holder.innerHTML=""; if(!j.messages||!j.messages.length){ holder.textContent="No messages for this number."; loaded=true; return; }
            j.messages.forEach(m=>{
              const rowEl=document.createElement("div"); rowEl.className="msgrow " + (m.direction==="inbound" ? "inbound" : "outbound");
              const ts=document.createElement("span"); ts.className="ts"; ts.textContent=fmtTsISO(m.dateSentUtc);
              const bubble=document.createElement("div"); bubble.className="bubble " + (m.direction==="inbound" ? "in" : "out"); bubble.innerHTML=esc(m.body);
              rowEl.appendChild(ts); rowEl.appendChild(bubble); holder.appendChild(rowEl);
            });
            if (j.sentiment) paintSentiment(badge, j.sentiment);
            loaded=true;
          }catch(e){ holder.textContent=(e&&e.message)||"Failed to load messages."; }
        }
      });
      _sentPending++;
      setTimeout(()=>{ const p = hydrateSentiment(row.phone, f, tt, badge); Promise.resolve(p).finally(()=>{ _sentPending = Math.max(0, _sentPending - 1); if (_sentPending === 0 && _latestMetrics) { renderDirChartData(_latestMetrics); } }); }, 50 * i);
    });
    const tableWrap = document.createElement("div");
    tableWrap.className = "table-scroll";
    tableWrap.appendChild(table);
    box.appendChild(tableWrap);
  }

  function ingestMaxDay(){
    const now = new Date();
    const y = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    y.setUTCDate(y.getUTCDate() - 1);
    return ymd(y);
  }
  function syncIngestRangeDefaults(){
    const maxDay = ingestMaxDay();
    if (ingestFrom){
      ingestFrom.max = maxDay;
      if (!ingestFrom.value){
        ingestFrom.value = (from && from.value) ? from.value : maxDay;
      } else if (ingestFrom.value > maxDay){
        ingestFrom.value = maxDay;
      }
    }
    if (ingestTo){
      ingestTo.max = maxDay;
      const seed = (to && to.value) ? to.value : (ingestFrom ? ingestFrom.value : "");
      if (!ingestTo.value){
        ingestTo.value = seed || maxDay;
      } else if (ingestTo.value > maxDay){
        ingestTo.value = maxDay;
      }
    }
    if (ingestFrom && ingestTo){
      if (ingestFrom.value && ingestTo.value && ingestFrom.value > ingestTo.value){
        ingestTo.value = ingestFrom.value;
      }
      ingestTo.min = ingestFrom.value || "";
    }
  }
  function showModal(id){ const el=$(id); if(el) el.style.display="flex"; }
  function hideModal(id){ const el=$(id); if(el) el.style.display="none"; }
  function openIngestModal(){ if(ingestError) ingestError.textContent=""; syncIngestRangeDefaults(); showModal("ingestModal"); }
  function closeIngestModal(){ hideModal("ingestModal"); if(ingestError) ingestError.textContent=""; }
  function buildCalendarEventsTable(items){
    const table=document.createElement("table");
    const thead=document.createElement("thead");
    const trh=document.createElement("tr");
    ["Event","Start","Date Added"].forEach(h=>{ const th=document.createElement("th"); th.textContent=h; trh.appendChild(th); });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody=document.createElement("tbody");
    table.appendChild(tbody);
    items.forEach(item=>{
      const tr=document.createElement("tr");
      const td1=document.createElement("td");
      const title=(item.title||"").trim()||"(untitled event)";
      if(item.ghlUrl){ const a=document.createElement("a"); a.href=item.ghlUrl; a.target="_blank"; a.rel="noreferrer"; a.textContent=title; a.style.color="#fff"; a.style.textDecoration="none"; td1.appendChild(a); }
      else { td1.textContent=title; }
      if(item.contactId){ const sub=document.createElement("div"); sub.className="muted"; sub.style.fontSize="12px"; sub.textContent=item.contactId; td1.appendChild(sub); }
      const td2=document.createElement("td"); td2.style.textAlign="right";
      const startDateText = fmtDateOnly(item.startTimeUtc || item.startTimeRaw);
      const startDate=document.createElement("div"); startDate.textContent=startDateText || "—"; td2.appendChild(startDate);
      if(item.appointmentStatus){ const sub=document.createElement("div"); sub.className="muted"; sub.style.fontSize="12px"; sub.textContent=String(item.appointmentStatus); td2.appendChild(sub); }
      tr.appendChild(td1);
      tr.appendChild(td2);
      const td3=document.createElement("td"); td3.style.textAlign="right";
      const addedDateText = fmtDateOnly(item.dateAddedUtc || item.dateAddedRaw);
      const addDate=document.createElement("div"); addDate.textContent=addedDateText || "—"; td3.appendChild(addDate);
      tr.appendChild(td3);
      tbody.appendChild(tr);
    });
    return table;
  }
  function renderCalendarEventsModal(){
    const list=$("calendarEventsList");
    if(!list) return;
    list.innerHTML="";
    if(!_calendarEvents.length){ const empty=document.createElement("div"); empty.className="muted"; empty.textContent="No calendar events found for this window."; list.appendChild(empty); return; }
    const groupsMap=new Map();
    const groups=[];
    _calendarEvents.forEach(item=>{
      const raw=(item.appointmentStatus==null?"":String(item.appointmentStatus)).trim();
      const key=raw?raw.toLowerCase():"unknown";
      let entry=groupsMap.get(key);
      if(!entry){ entry={ key, label: formatEventStatus(raw||""), items: [] }; groupsMap.set(key, entry); groups.push(entry); }
      entry.items.push(item);
    });
    groups.sort((a,b)=>{
      const diff=b.items.length-a.items.length;
      if(diff!==0) return diff;
      return a.label.localeCompare(b.label);
    });
    if(!_calendarEventsStatusFilter){
      const summary=document.createElement("div");
      summary.className="calendar-status-summary";
      groups.forEach(group=>{
        const tile=document.createElement("button");
        tile.type="button";
        tile.className="status-tile";
        const count=document.createElement("div"); count.className="status-count"; count.textContent=group.items.length.toLocaleString();
        const label=document.createElement("div"); label.className="status-label"; label.textContent=group.label;
        tile.appendChild(count);
        tile.appendChild(label);
        tile.addEventListener("click", ()=>{ _calendarEventsStatusFilter=group.key; renderCalendarEventsModal(); });
        summary.appendChild(tile);
      });
      list.appendChild(summary);
    } else {
      const target=groupsMap.get(_calendarEventsStatusFilter);
      if(!target){ _calendarEventsStatusFilter=null; renderCalendarEventsModal(); return; }
      const head=document.createElement("div"); head.className="status-detail-head";
      const backBtn=document.createElement("button"); backBtn.type="button"; backBtn.className="ghost-btn"; backBtn.textContent="← All statuses";
      backBtn.addEventListener("click", ()=>{ _calendarEventsStatusFilter=null; renderCalendarEventsModal(); });
      const meta=document.createElement("div"); meta.className="muted"; meta.textContent=`${target.label} • ${target.items.length} event${target.items.length===1?"":"s"}`;
      head.appendChild(backBtn);
      head.appendChild(meta);
      list.appendChild(head);
      list.appendChild(buildCalendarEventsTable(target.items));
    }
  }
  function openCalendarEventsModal(){ _calendarEventsStatusFilter=null; renderCalendarEventsModal(); showModal("calendarEventsModal"); }
  function closeCalendarEventsModal(){ _calendarEventsStatusFilter=null; hideModal("calendarEventsModal"); }
  function renderForms(submissions){
    if (!formsTableBody || !formsResults) return;
    formsTableBody.innerHTML = "";
    const list = Array.isArray(submissions) ? submissions : [];
    if (!list.length){
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = FORM_FIELD_COLUMNS.length + 2;
      td.textContent = _tenantHasForm ? "No submissions for this range." : "Forms not configured for this tenant.";
      td.className = "muted";
      tr.appendChild(td);
      formsTableBody.appendChild(tr);
      formsResults.style.display = _tenantHasForm ? "block" : "none";
      return;
    }
    list.forEach(sub => {
      const tr = document.createElement("tr");
      const tdContact = document.createElement("td");
      tdContact.textContent = sub?.contactId || "—";
      tr.appendChild(tdContact);
      FORM_FIELD_COLUMNS.forEach(col => {
        const td = document.createElement("td");
        const val = sub?.fields ? sub.fields[col.id] : undefined;
        td.textContent = (val === undefined || val === null || val === "") ? "—" : String(val);
        tr.appendChild(td);
      });
      const tdCreated = document.createElement("td");
      tdCreated.textContent = fmtDateOnly(sub?.createdAt) || "—";
      tr.appendChild(tdCreated);
      formsTableBody.appendChild(tr);
    });
    formsResults.style.display = "block";
  }
  async function loadForms(){
    if (!formsError) return;
    formsError.textContent = "";
    closeAllDatePickers();
    if (!_tenantHasForm){
      formsError.textContent = "No form configured for this tenant.";
      renderForms([]);
      return;
    }
    const t = sessionStorage.getItem("authToken");
    if (!t){ formsError.textContent = "No token. Go back to / and login."; return; }
    const f = (formsFrom?.value || "").trim();
    const tt = (formsTo?.value || "").trim();
    if (!f || !tt){ formsError.textContent = "Pick dates."; return; }
    if (f > tt){ formsError.textContent = "From must be before To."; return; }
    setLoading(true, defaultLoadingText);
    try {
      const resp = await fetch(`/api/forms-submissions?from=${encodeURIComponent(f)}&to=${encodeURIComponent(tt)}`, { headers: hdr(t) });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok){ throw new Error(payload?.error || "forms_failed"); }
      updateFormsTabVisibility(payload?.hasForm !== false);
      renderForms(payload?.submissions || []);
    } catch (err) {
      formsError.textContent = err?.message || "Failed to load submissions.";
      renderForms([]);
    } finally {
      setLoading(false, defaultLoadingText);
    }
  }
  document.addEventListener("keydown", (e)=>{ if (e.key==="Escape"){ closeIngestModal(); closeCalendarEventsModal(); closeErrorsModal(); closeUserListModal(); closeCreateUserModal(); closeEditUserModal(); closeAllDatePickers(); closeUserMenu(); } });
  document.addEventListener("click", () => { closeAllDatePickers(); closeUserMenu(); });
  ["ingestModal","calendarEventsModal","errorsModal","userListModal","userCreateModal","userEditModal"].forEach(id=>{
    const el=$(id);
    if(!el) return;
    el.addEventListener("click", (e)=>{
      if (e.target.id!==id) return;
      if (id === "ingestModal"){
        closeIngestModal();
      } else {
        hideModal(id);
      }
    });
  });

  async function runIngestRange(){
    if (errorBox) errorBox.textContent = "";
    if (ingestError) ingestError.textContent = "";
    const token = sessionStorage.getItem("authToken");
    if (!token){
      if (ingestError) ingestError.textContent = "No session token. Please sign in again.";
      return;
    }
    if (!ingestFrom || !ingestTo){
      if (ingestError) ingestError.textContent = "Ingest inputs unavailable.";
      return;
    }
    const fromVal = (ingestFrom.value || "").trim();
    const toVal = (ingestTo.value || "").trim();
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(fromVal) || !re.test(toVal)){
      if (ingestError) ingestError.textContent = "Please select valid From/To dates (YYYY-MM-DD).";
      return;
    }
    const fromDate = new Date(fromVal + "T00:00:00Z");
    const toDate = new Date(toVal + "T00:00:00Z");
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())){
      if (ingestError) ingestError.textContent = "Unable to parse the selected dates.";
      return;
    }
    const today = new Date();
    today.setUTCHours(0,0,0,0);
    if (toDate >= today || fromDate >= today){
      if (ingestError) ingestError.textContent = "Future dates are not allowed.";
      syncIngestRangeDefaults();
      return;
    }
    if (fromDate > toDate){
      if (ingestError) ingestError.textContent = "The From date must be on or before the To date.";
      syncIngestRangeDefaults();
      return;
    }
    const params = new URLSearchParams({ from: fromVal, to: toVal });
    const loadingMsg = "Processing… This may take several minutes. Hold on tight.";
    setLoading(true, loadingMsg);
    try{
      const resp = await fetch(`/api/ingest?${params.toString()}`, { method: "POST", headers: hdr(token) });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload?.ok){
        throw new Error((payload && (payload.detail || payload.error)) || "Ingest failed.");
      }
      await loadMetrics();
      closeIngestModal();
    }catch(err){
      if (ingestError) ingestError.textContent = err?.message || "Ingest failed.";
    }finally{
      setLoading(false);
    }
  }

  async function runAllTenantsIngest(){
    if (!_isSuper) return;
    if (errorBox) errorBox.textContent = "";
    const token = sessionStorage.getItem("authToken");
    if (!token){
      if (errorBox) errorBox.textContent = "No session token. Please sign in again.";
      return;
    }
    const loadingMsg = "Processing… This may take several minutes. Hold on tight.";
    setLoading(true, loadingMsg);
    try{
      const resp = await fetch("/api/cron/daily-ingest", { method: "POST", headers: hdr(token) });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload?.ok){
        throw new Error((payload && (payload.detail || payload.error)) || "Run failed.");
      }
      await loadMetrics();
    }catch(err){
      if (errorBox) errorBox.textContent = err?.message || "Failed to run daily ingest.";
    }finally{
      setLoading(false);
    }
  }

  const btnLoad=$("load"); if (btnLoad) btnLoad.addEventListener("click", loadMetrics);
  const btnOpen=$("ingestOpen"); if (btnOpen) btnOpen.addEventListener("click", openIngestModal);
  const btnRun=$("ingestRun"); if (btnRun) btnRun.addEventListener("click", runIngestRange);
  const btnCancel=$("ingestCancel"); if (btnCancel) btnCancel.addEventListener("click", closeIngestModal);
  const btnRunAll=$("runAllIngest"); if (btnRunAll) btnRunAll.addEventListener("click", runAllTenantsIngest);
  const btnCalendarEventsClose=$("calendarEventsClose"); if (btnCalendarEventsClose) btnCalendarEventsClose.addEventListener("click", closeCalendarEventsModal);
  const calendarEventsCard=$("calendarEventsCard"); if (calendarEventsCard) calendarEventsCard.addEventListener("click", openCalendarEventsModal);
  if (userMenuBtn){ userMenuBtn.addEventListener("click", ev => { ev.stopPropagation(); if (_isSuper) toggleUserMenu(); }); }
  if (userMenu){ userMenu.addEventListener("click", ev => { ev.stopPropagation(); const target = ev.target.closest("button[data-action]"); if (!target) return; const action = target.dataset.action; if (action === "create") { openCreateUserModal(); } else if (action === "edit") { openUserListModal(); } }); }
  if (userListContent){ userListContent.addEventListener("click", ev => { const btn = ev.target.closest("button[data-user-id]"); if (!btn) return; ev.preventDefault(); const id = btn.dataset.userId; closeUserListModal(); openEditUserModal(id); }); }
  const userListClose=$("userListClose"); if (userListClose) userListClose.addEventListener("click", closeUserListModal);
  const userCreateClose=$("userCreateClose"); if (userCreateClose) userCreateClose.addEventListener("click", closeCreateUserModal);
  const userCreateCancel=$("userCreateCancel"); if (userCreateCancel) userCreateCancel.addEventListener("click", closeCreateUserModal);
  if (userCreateForm) userCreateForm.addEventListener("submit", submitCreateUser);
  if (userCreateRole) userCreateRole.addEventListener("change", () => updateRoleSections(userCreateForm, userCreateRole.value || "owner"));
  const userEditClose=$("userEditClose"); if (userEditClose) userEditClose.addEventListener("click", closeEditUserModal);
  const userEditCancel=$("userEditCancel"); if (userEditCancel) userEditCancel.addEventListener("click", closeEditUserModal);
  if (userEditForm) userEditForm.addEventListener("submit", submitEditUser);
  if (userEditRole) userEditRole.addEventListener("change", () => updateRoleSections(userEditForm, userEditRole.value || "owner"));

  initTenantDropdown().finally(loadMetrics);
});
