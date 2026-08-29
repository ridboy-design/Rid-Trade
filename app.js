let currentBars = null;
let currentCsvName = "";

function $(id) { return document.getElementById(id); }

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "monitor") refreshMonitor();
  });
});

function getStrategies() {
  return JSON.parse(localStorage.getItem("strategies") || "{}");
}
function setStrategies(obj) {
  localStorage.setItem("strategies", JSON.stringify(obj));
}
function refreshStrategyList() {
  const strategies = getStrategies();
  const sel = $("strategySelect");
  sel.innerHTML = '<option value="">(new strategy)</option>';
  Object.keys(strategies).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name; opt.textContent = name;
    sel.appendChild(opt);
  });
}
$("strategySelect").addEventListener("change", () => {
  const name = $("strategySelect").value;
  if (!name) return;
  const s = getStrategies()[name];
  if (s) { $("nameInput").value = name; $("codeInput").value = s.code; }
});
$("saveBtn").addEventListener("click", () => {
  const name = $("nameInput").value.trim();
  if (!name) { $("output").textContent = "Enter a name first."; return; }
  const strategies = getStrategies();
  strategies[name] = { code: $("codeInput").value, updated: Date.now() };
  setStrategies(strategies);
  refreshStrategyList();
  $("strategySelect").value = name;
  $("output").textContent = "Saved strategy '" + name + "'.";
});
$("deleteBtn").addEventListener("click", () => {
  const name = $("nameInput").value.trim();
  const strategies = getStrategies();
  delete strategies[name];
  setStrategies(strategies);
  refreshStrategyList();
  $("output").textContent = "Deleted '" + name + "' (if it existed).";
});

$("csvFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  currentCsvName = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      currentBars = parseCSV(reader.result);
      $("csvStatus").textContent = `Loaded ${currentBars.length} bars from ${currentCsvName}`;
    } catch (err) {
      currentBars = null;
      $("csvStatus").textContent = "Error: " + err.message;
    }
  };
  reader.readAsText(file);
});

$("modeSelect").addEventListener("change", () => {
  const mode = $("modeSelect").value;
  if (mode === "Optimize") {
    $("paramsLabel").textContent = "Grid (key=v1,v2;key=v3,v4) — blank uses PARAM_GRID";
  } else {
    $("paramsLabel").textContent = "Params (key=val,key=val) — blank uses DEFAULT_PARAMS";
  }
});

function getRuns() {
  return JSON.parse(localStorage.getItem("runs") || "[]");
}
function saveRun(record) {
  const runs = getRuns();
  record.ts = Date.now();
  runs.push(record);
  localStorage.setItem("runs", JSON.stringify(runs));
}
function refreshMonitor() {
  const runs = getRuns().slice().reverse();
  if (runs.length === 0) {
    $("monitorOutput").textContent = "No runs yet. Go to Strategies tab and hit RUN.";
    return;
  }
  const lines = [];
  runs.forEach(r => {
    const dt = new Date(r.ts).toLocaleString();
    lines.push(`${r.strategy}  [${r.mode}]  ${dt}`);
    if (r.mode === "Walk-Forward" && r.summary && r.summary.explore) {
      lines.push(`  explore PF: ${r.summary.explore.profit_factor}  holdout PF: ${r.summary.holdout.profit_factor}`);
    } else if (r.summary) {
      lines.push("  " + JSON.stringify(r.summary));
    }
    lines.push("");
  });
  $("monitorOutput").textContent = lines.join("\n");
}
$("refreshBtn").addEventListener("click", refreshMonitor);

$("runBtn").addEventListener("click", () => {
  const name = $("nameInput").value.trim() || "unnamed";
  const mode = $("modeSelect").value;
  const code = $("codeInput").value;
  const out = $("output");

  if (!currentBars) { out.textContent = "Load a CSV first."; return; }

  try {
    if (mode === "Single") {
      const params = parseParams($("paramsInput").value);
      const result = runSingle(currentBars, code, params);
      out.textContent = "params: " + JSON.stringify(result.params) + "\n\n" +
        Object.entries(result.metrics).map(([k, v]) => `${k}: ${v}`).join("\n");
      saveRun({ strategy: name, mode, summary: result.metrics, params: result.params });

    } else if (mode === "Optimize") {
      const grid = parseGrid($("paramsInput").value);
      const results = runOptimize(currentBars, code, Object.keys(grid).length ? grid : null);
      if (results.length === 0) {
        out.textContent = "No configs met the minimum trade count (15).";
      } else {
        const lines = ["Top results (by PF):"];
        results.slice(0, 15).forEach(r => {
          lines.push(`${JSON.stringify(r.params)} -> PF ${r.profit_factor}, trades ${r.num_trades}, exp ${r.expectancy_r}R`);
        });
        out.textContent = lines.join("\n");
        saveRun({ strategy: name, mode, summary: results[0], numConfigsTested: results.length });
      }

    } else if (mode === "Walk-Forward") {
      const params = parseParams($("paramsInput").value);
      const result = runWalkForward(currentBars, code, params);
      const lines = ["params: " + JSON.stringify(result.params), "split date: " + result.cutDate, "",
        "-- EXPLORE --", ...Object.entries(result.explore).map(([k, v]) => `${k}: ${v}`),
        "", "-- HOLDOUT --", ...Object.entries(result.holdout).map(([k, v]) => `${k}: ${v}`)];
      out.textContent = lines.join("\n");
      saveRun({ strategy: name, mode, summary: { explore: result.explore, holdout: result.holdout }, params: result.params });
    }
  } catch (e) {
    out.textContent = "Error: " + e.message;
  }
});

refreshStrategyList();
$("codeInput").value = DEFAULT_TEMPLATE;