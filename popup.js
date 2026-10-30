const api = typeof browser !== "undefined" ? browser : chrome;

const ui = {
  runBtn: document.getElementById("runTest"),
  readyState: document.getElementById("readyState"),
  status: document.getElementById("status"),

  serverValue: document.getElementById("serverValue"),
  ipValue: document.getElementById("ipValue"),
  countryValue: document.getElementById("countryValue"),

  gaugeLabel: document.getElementById("gaugeLabel"),
  gaugeValue: document.getElementById("gaugeValue"),
  gaugeUnit: document.getElementById("gaugeUnit"),

  scaleMin: document.getElementById("scaleMin"),
  scaleMid: document.getElementById("scaleMid"),
  scaleMax: document.getElementById("scaleMax"),

  gaugeTrack: document.getElementById("gaugeTrack"),
  gaugeProgress: document.getElementById("gaugeProgress"),

  metricCards: Array.from(document.querySelectorAll(".metric")),
  phaseItems: Array.from(document.querySelectorAll(".phase")),
  downloadMetric: document.getElementById("downloadMetric"),
  uploadMetric: document.getElementById("uploadMetric"),
  pingMetric: document.getElementById("pingMetric")
};

const labels = {
  download: "Входящая скорость",
  upload: "Исходящая скорость",
  ping: "Ping"
};

const state = {
  selectedMetric: "download",
  activePhase: null,
  completedPhases: new Set(),
  isRunning: false,
  server: "Cloudflare Edge",
  ip: "—",
  country: "—",
  results: {
    download: null,
    upload: null,
    ping: null
  }
};

const gaugeLength = ui.gaugeTrack.getTotalLength();
ui.gaugeProgress.style.strokeDasharray = `${gaugeLength}`;
ui.gaugeProgress.style.strokeDashoffset = `${gaugeLength}`;

function setStatus(text) {
  ui.status.textContent = text || "";
}

function setReadyState(text) {
  ui.readyState.textContent = text;
}

function setPhase(activePhase, completed = []) {
  state.activePhase = activePhase;
  state.completedPhases = new Set(completed);

  for (const item of ui.phaseItems) {
    const phase = item.dataset.phase;
    item.classList.toggle("active", phase === activePhase);
    item.classList.toggle("done", state.completedPhases.has(phase));
  }
}

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function round(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return null;
  return Number(value.toFixed(digits));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatMetricValue(metric, value) {
  if (value == null || Number.isNaN(value)) return "—";
  if (metric === "ping") return String(Math.round(value));
  return value.toFixed(value >= 100 ? 0 : 1);
}

function getMetricUnit(metric) {
  return metric === "ping" ? "ms" : "Mbps";
}

function getGaugeMax(metric, rawValue) {
  if (metric === "ping") return 300;
  if (rawValue != null && rawValue > 1000) return Math.ceil(rawValue / 500) * 500;
  return 1000;
}

function updateGauge(metric, rawValue) {
  const max = getGaugeMax(metric, rawValue);
  const value = rawValue == null ? null : clamp(rawValue, 0, max);
  const ratio = value == null ? 0 : clamp(value / max, 0, 1);
  const offset = gaugeLength * (1 - ratio);

  ui.gaugeLabel.textContent = labels[metric];
  ui.gaugeValue.textContent = formatMetricValue(metric, value);
  ui.gaugeUnit.textContent = getMetricUnit(metric);

  ui.scaleMin.textContent = "0";
  ui.scaleMid.textContent = String(Math.round(max / 2));
  ui.scaleMax.textContent = String(max);

  ui.gaugeProgress.style.strokeDashoffset = `${offset}`;
}

function renderMetricCards() {
  ui.downloadMetric.textContent = formatMetricValue("download", state.results.download);
  ui.uploadMetric.textContent = formatMetricValue("upload", state.results.upload);
  ui.pingMetric.textContent = formatMetricValue("ping", state.results.ping);

  for (const card of ui.metricCards) {
    const isActive = card.dataset.metric === state.selectedMetric;
    card.classList.toggle("active", isActive);
    card.setAttribute("aria-pressed", String(isActive));
  }
}

function renderInfo() {
  ui.serverValue.textContent = state.server;
  ui.ipValue.textContent = state.ip || "—";
  ui.countryValue.textContent = state.country || "—";
}

function renderAll() {
  renderInfo();
  renderMetricCards();
  updateGauge(state.selectedMetric, state.results[state.selectedMetric]);
}

function selectMetric(metric) {
  state.selectedMetric = metric;
  renderMetricCards();
  updateGauge(metric, state.results[metric]);
}

function metricUpdate(metric, value) {
  state.results[metric] = value;
  state.selectedMetric = metric;
  renderAll();
}

function parseTrace(text) {
  const lines = text.split("\n").map(s => s.trim()).filter(Boolean);
  const map = {};

  for (const line of lines) {
    const [key, ...rest] = line.split("=");
    map[key] = rest.join("=");
  }

  return map;
}

function countryNameFromCode(code) {
  if (!code || code === "—") return "—";

  try {
    if (typeof Intl !== "undefined" && Intl.DisplayNames) {
      const dn = new Intl.DisplayNames(["ru"], { type: "region" });
      return dn.of(code) || code;
    }
  } catch {}

  return code;
}

function makeRandomBytes(size) {
  const buffer = new Uint8Array(size);

  for (let i = 0; i < size; i += 65536) {
    crypto.getRandomValues(buffer.subarray(i, Math.min(i + 65536, size)));
  }

  return buffer;
}

async function cloudflareMeta() {
  const response = await fetch(`https://speed.cloudflare.com/cdn-cgi/trace?ts=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Cloudflare trace failed");
  }

  const text = await response.text();
  const parsed = parseTrace(text);

  return {
    ip: parsed.ip || "—",
    country: countryNameFromCode(parsed.loc || "—")
  };
}

async function cloudflarePing(samples = 4, onUpdate) {
  const times = [];

  for (let i = 0; i < samples; i++) {
    const start = performance.now();

    const response = await fetch(
      `https://speed.cloudflare.com/__down?bytes=1&seed=${Date.now()}_${i}`,
      { cache: "no-store" }
    );

    await response.arrayBuffer();

    const ms = performance.now() - start;
    times.push(ms);

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    if (onUpdate) onUpdate(avg);

    await sleep(120);
  }

  return times.reduce((a, b) => a + b, 0) / times.length;
}

async function streamDownload(url, onUpdate) {
  const start = performance.now();
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  if (!response.body || !response.body.getReader) {
    const buf = await response.arrayBuffer();
    const elapsed = (performance.now() - start) / 1000;
    const mbps = ((buf.byteLength * 8) / elapsed) / 1_000_000;

    if (onUpdate) onUpdate(mbps);
    return mbps;
  }

  const reader = response.body.getReader();
  let bytes = 0;
  let lastPaint = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    bytes += value.byteLength;

    const now = performance.now();
    if (now - lastPaint > 120) {
      const seconds = (now - start) / 1000;
      const mbps = ((bytes * 8) / seconds) / 1_000_000;
      if (onUpdate) onUpdate(mbps);
      lastPaint = now;
    }
  }

  const totalSeconds = (performance.now() - start) / 1000;
  const finalMbps = ((bytes * 8) / totalSeconds) / 1_000_000;

  if (onUpdate) onUpdate(finalMbps);
  return finalMbps;
}

async function chunkedUpload(url, durationMs, chunkSize, onUpdate) {
  const start = performance.now();
  let bytesSent = 0;
  let sentAtLeastOnce = false;

  while (performance.now() - start < durationMs) {
    const chunk = makeRandomBytes(chunkSize);

    const response = await fetch(`${url}?seed=${Date.now()}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/octet-stream"
      },
      body: chunk
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    bytesSent += chunk.byteLength;
    sentAtLeastOnce = true;

    const seconds = (performance.now() - start) / 1000;
    const mbps = ((bytesSent * 8) / seconds) / 1_000_000;
    if (onUpdate) onUpdate(mbps);
  }

  if (!sentAtLeastOnce) {
    throw new Error("Upload did not start");
  }

  const totalSeconds = (performance.now() - start) / 1000;
  const finalMbps = ((bytesSent * 8) / totalSeconds) / 1_000_000;

  if (onUpdate) onUpdate(finalMbps);
  return finalMbps;
}

async function runCloudflareTest() {
  state.server = "Cloudflare Edge";
  renderInfo();

  setPhase("meta");
  setStatus("Определяю IP и страну...");
  const meta = await cloudflareMeta();
  state.ip = meta.ip;
  state.country = meta.country;
  renderInfo();

  setPhase("download", ["meta"]);
  setStatus("Измеряю входящую скорость...");
  const download = await streamDownload(
    `https://speed.cloudflare.com/__down?bytes=${30 * 1024 * 1024}&seed=${Date.now()}`,
    value => metricUpdate("download", value)
  );

  setPhase("upload", ["meta", "download"]);
  setStatus("Измеряю исходящую скорость...");
  const upload = await chunkedUpload(
    "https://speed.cloudflare.com/__up",
    4200,
    512 * 1024,
    value => metricUpdate("upload", value)
  );

  setPhase("ping", ["meta", "download", "upload"]);
  setStatus("Измеряю ping...");
  const ping = await cloudflarePing(4, value => metricUpdate("ping", value));

  setPhase(null, ["meta", "download", "upload", "ping"]);

  return {
    download,
    upload,
    ping,
    ip: meta.ip,
    country: meta.country
  };
}

async function runTest() {
  if (state.isRunning) return;

  state.isRunning = true;
  ui.runBtn.disabled = true;
  ui.runBtn.textContent = "Проверяю...";
  setReadyState("Run");

  state.ip = "—";
  state.country = "—";
  state.results.download = null;
  state.results.upload = null;
  state.results.ping = null;
  renderAll();

  setPhase(null);
  setStatus("Запуск теста...");

  try {
    const result = await runCloudflareTest();

    state.results.download = round(result.download, 1);
    state.results.upload = round(result.upload, 1);
    state.results.ping = round(result.ping, 0);
    state.ip = result.ip || "—";
    state.country = result.country || "—";
    state.selectedMetric = "download";

    renderAll();
    setReadyState("Done");
    setStatus("Готово. Последний результат сохранен.");

    await api.storage.local.set({
      last_speed_result: state.results,
      last_speed_ip: state.ip,
      last_speed_country: state.country
    });
  } catch (error) {
    console.error(error);
    setReadyState("Error");
    setPhase(null);
    setStatus("Не удалось выполнить тест. Проверьте соединение и попробуйте еще раз.");
  } finally {
    state.isRunning = false;
    ui.runBtn.disabled = false;
    ui.runBtn.textContent = "Проверить скорость";
  }
}

ui.runBtn.addEventListener("click", runTest);

for (const card of ui.metricCards) {
  card.addEventListener("click", () => {
    selectMetric(card.dataset.metric);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const saved = await api.storage.local.get([
      "last_speed_result",
      "last_speed_ip",
      "last_speed_country"
    ]);

    if (saved.last_speed_result) {
      state.results = {
        download: saved.last_speed_result.download ?? null,
        upload: saved.last_speed_result.upload ?? null,
        ping: saved.last_speed_result.ping ?? null
      };
      setStatus("Показан последний сохраненный результат.");
    }

    if (saved.last_speed_ip) {
      state.ip = saved.last_speed_ip;
    }

    if (saved.last_speed_country) {
      state.country = saved.last_speed_country;
    }
  } catch (error) {
    console.error(error);
  }

  renderAll();
});
