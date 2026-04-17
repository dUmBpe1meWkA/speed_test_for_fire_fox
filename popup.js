const BASE_URL = 'https://speed.cloudflare.com';
const DOWNLOAD_SIZE_BYTES = 24 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 1024 * 1024;
const UPLOAD_CHUNKS = 8;
const PING_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 20000;
const UI_UPDATE_INTERVAL_MS = 120;

const metricConfig = {
  download: {
    label: 'Входящая скорость',
    unit: 'Mbps',
    min: 0,
    mid: 100,
    max: 200,
    formatValue: (value) => (Number.isFinite(value) ? value.toFixed(value >= 100 ? 0 : 1) : '—')
  },
  upload: {
    label: 'Исходящая скорость',
    unit: 'Mbps',
    min: 0,
    mid: 50,
    max: 100,
    formatValue: (value) => (Number.isFinite(value) ? value.toFixed(value >= 100 ? 0 : 1) : '—')
  },
  ping: {
    label: 'Ping',
    unit: 'ms',
    min: 0,
    mid: 100,
    max: 200,
    formatValue: (value) => (Number.isFinite(value) ? Math.round(value).toString() : '—')
  }
};

const metricValues = {
  download: null,
  upload: null,
  ping: null
};

let selectedMetric = 'download';
let isMeasuring = false;
let progressLength = 0;

const ipEl = document.getElementById('ipValue');
const countryEl = document.getElementById('countryValue');
const pingMetricEl = document.getElementById('pingMetric');
const downloadMetricEl = document.getElementById('downloadMetric');
const uploadMetricEl = document.getElementById('uploadMetric');
const statusEl = document.getElementById('status');
const buttonEl = document.getElementById('runTest');
const gaugeLabelEl = document.getElementById('gaugeLabel');
const gaugeValueEl = document.getElementById('gaugeValue');
const gaugeUnitEl = document.getElementById('gaugeUnit');
const scaleMinEl = document.getElementById('scaleMin');
const scaleMidEl = document.getElementById('scaleMid');
const scaleMaxEl = document.getElementById('scaleMax');
const progressEl = document.getElementById('gaugeProgress');
const needleEl = document.getElementById('gaugeNeedle');
const ticksEl = document.getElementById('gaugeTicks');
const metricButtons = Array.from(document.querySelectorAll('.metric'));

function setStatus(text) {
  statusEl.textContent = text;
}

function setBusy(busy) {
  isMeasuring = busy;
  buttonEl.disabled = busy;
  buttonEl.textContent = busy ? 'Идёт замер...' : 'Проверить скорость';
}

function buildNoCacheUrl(url) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      ...options
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function flagFromCountryCode(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '🌍';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function countryNameFromCode(countryCode) {
  try {
    const displayNames = new Intl.DisplayNames(['ru'], { type: 'region' });
    return displayNames.of(countryCode?.toUpperCase() || '') || countryCode || 'Неизвестно';
  } catch {
    return countryCode || 'Неизвестно';
  }
}

async function loadIpInfo() {
  try {
    const response = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace');
    if (!response.ok) throw new Error(`Trace status ${response.status}`);

    const text = await response.text();
    const data = Object.fromEntries(
      text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf('=');
          return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
        })
    );

    const ip = data.ip || 'Не найден';
    const countryCode = (data.loc || '').toUpperCase();
    const countryName = countryNameFromCode(countryCode);

    ipEl.textContent = ip;
    countryEl.textContent = `${flagFromCountryCode(countryCode)} ${countryName}`;
  } catch (error) {
    console.warn('IP lookup failed:', error);
    ipEl.textContent = 'Не удалось';
    countryEl.textContent = 'Не удалось';
  }
}

function polarToCartesian(cx, cy, radius, angleDeg) {
  const angleRad = (angleDeg - 90) * (Math.PI / 180);
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad)
  };
}

function drawTicks() {
  if (ticksEl.childElementCount > 0) return;

  const totalTicks = 9;
  const startAngle = -90;
  const endAngle = 90;

  for (let i = 0; i <= totalTicks; i += 1) {
    const t = i / totalTicks;
    const angle = startAngle + (endAngle - startAngle) * t;
    const outer = polarToCartesian(160, 160, 136, angle);
    const inner = polarToCartesian(160, 160, i % 3 === 0 ? 118 : 124, angle);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', inner.x.toFixed(2));
    line.setAttribute('y1', inner.y.toFixed(2));
    line.setAttribute('x2', outer.x.toFixed(2));
    line.setAttribute('y2', outer.y.toFixed(2));
    line.setAttribute('stroke-width', i % 3 === 0 ? '4' : '2.5');
    ticksEl.appendChild(line);
  }
}

function ensureGaugeReady() {
  if (progressLength > 0) return;
  progressLength = progressEl.getTotalLength();
  progressEl.style.strokeDasharray = `${progressLength}`;
  progressEl.style.strokeDashoffset = `${progressLength}`;
  drawTicks();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function displayMetricValue(metricName, value) {
  return metricConfig[metricName].formatValue(value);
}

function autoScaleValue(metricName, value) {
  const config = metricConfig[metricName];
  if (!Number.isFinite(value)) return config;

  const min = 0;
  let max = config.max;
  while (value > max && max < 10000) {
    max *= 2;
  }
  const mid = Math.round(max / 2);
  return { ...config, min, mid, max };
}

function setGauge(metricName, value) {
  ensureGaugeReady();

  const config = autoScaleValue(metricName, value);
  const boundedValue = Number.isFinite(value) ? clamp(value, config.min, config.max) : 0;
  const range = config.max - config.min || 1;
  const progress = Number.isFinite(value) ? (boundedValue - config.min) / range : 0;
  const offset = progressLength * (1 - progress);
  const angle = -90 + 180 * progress;

  gaugeLabelEl.textContent = config.label;
  gaugeUnitEl.textContent = config.unit;
  gaugeValueEl.textContent = displayMetricValue(metricName, value);
  scaleMinEl.textContent = `${config.min}`;
  scaleMidEl.textContent = `${config.mid}`;
  scaleMaxEl.textContent = `${config.max}`;
  progressEl.style.strokeDashoffset = `${offset}`;
  needleEl.style.transform = `rotate(${angle}deg)`;
}

function updateMetricCards() {
  downloadMetricEl.textContent = displayMetricValue('download', metricValues.download);
  uploadMetricEl.textContent = displayMetricValue('upload', metricValues.upload);
  pingMetricEl.textContent = displayMetricValue('ping', metricValues.ping);
}

function setSelectedMetric(metricName, { force = false } = {}) {
  if (isMeasuring && !force) return;

  selectedMetric = metricName;
  for (const button of metricButtons) {
    button.classList.toggle('active', button.dataset.metric === metricName);
  }
  setGauge(metricName, metricValues[metricName]);
}

function liveUpdateMetric(metricName, value, statusText) {
  metricValues[metricName] = value;
  updateMetricCards();
  selectedMetric = metricName;
  for (const button of metricButtons) {
    button.classList.toggle('active', button.dataset.metric === metricName);
  }
  setGauge(metricName, value);
  setStatus(statusText);
}

function resetMetrics() {
  metricValues.download = null;
  metricValues.upload = null;
  metricValues.ping = null;
  updateMetricCards();
  setGauge('download', null);
  for (const button of metricButtons) {
    button.classList.toggle('active', button.dataset.metric === 'download');
  }
  selectedMetric = 'download';
}

async function measureDownloadLive() {
  const response = await fetchWithTimeout(
    buildNoCacheUrl(`${BASE_URL}/__down?bytes=${DOWNLOAD_SIZE_BYTES}`),
    { method: 'GET' }
  );

  if (!response.ok || !response.body) {
    throw new Error('Не удалось начать тест входящей скорости.');
  }

  const reader = response.body.getReader();
  let receivedBytes = 0;
  let lastUiUpdate = 0;
  const start = performance.now();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;

      const now = performance.now();
      if (now - lastUiUpdate >= UI_UPDATE_INTERVAL_MS) {
        const seconds = Math.max((now - start) / 1000, 0.001);
        const mbps = (receivedBytes * 8) / seconds / 1_000_000;
        liveUpdateMetric('download', mbps, `Измеряю входящую: ${mbps.toFixed(mbps >= 100 ? 0 : 1)} Mbps`);
        lastUiUpdate = now;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  const seconds = Math.max((performance.now() - start) / 1000, 0.001);
  if (receivedBytes === 0) {
    throw new Error('Недостаточно данных для расчёта входящей скорости.');
  }

  return (receivedBytes * 8) / seconds / 1_000_000;
}

async function measureUploadLive() {
  const chunk = new Uint8Array(UPLOAD_CHUNK_BYTES);

  let sentBytes = 0;
  const start = performance.now();

  for (let i = 0; i < UPLOAD_CHUNKS; i += 1) {
    const response = await fetchWithTimeout(buildNoCacheUrl(`${BASE_URL}/__up`), {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream'
      },
      body: chunk
    });

    if (!response.ok) {
      throw new Error(`Upload сервер ответил кодом ${response.status}`);
    }

    sentBytes += chunk.byteLength;
    const seconds = Math.max((performance.now() - start) / 1000, 0.001);
    const mbps = (sentBytes * 8) / seconds / 1_000_000;
    liveUpdateMetric('upload', mbps, `Измеряю исходящую: ${mbps.toFixed(mbps >= 100 ? 0 : 1)} Mbps`);

    try {
      await response.text();
    } catch {
      // ignore
    }
  }

  const seconds = Math.max((performance.now() - start) / 1000, 0.001);
  return (sentBytes * 8) / seconds / 1_000_000;
}

async function measurePingLive() {
  const values = [];

  for (let i = 0; i < PING_ATTEMPTS; i += 1) {
    const start = performance.now();
    const response = await fetchWithTimeout(buildNoCacheUrl(`${BASE_URL}/__down?bytes=32`), {
      method: 'GET'
    });
    const end = performance.now();

    if (!response.ok) {
      throw new Error(`Ping сервер ответил кодом ${response.status}`);
    }

    try {
      if (response.body) {
        await response.body.cancel();
      }
    } catch {
      // ignore
    }

    values.push(end - start);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    liveUpdateMetric('ping', average, `Измеряю ping: попытка ${i + 1} из ${PING_ATTEMPTS}`);
  }

  values.sort((a, b) => a - b);
  if (values.length > 2) {
    values.shift();
    values.pop();
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

metricButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setSelectedMetric(button.dataset.metric);
  });
});

buttonEl.addEventListener('click', async () => {
  setBusy(true);
  resetMetrics();

  try {
    setStatus('Стартую замер...');

    const downloadMbps = await measureDownloadLive();
    liveUpdateMetric('download', downloadMbps, 'Входящая готова. Перехожу к исходящей...');

    const uploadMbps = await measureUploadLive();
    liveUpdateMetric('upload', uploadMbps, 'Исходящая готова. Перехожу к ping...');

    const ping = await measurePingLive();
    liveUpdateMetric('ping', ping, 'Готово. Нажми на карточку, чтобы вывести нужную метрику на спидометр.');

    selectedMetric = 'download';
    for (const button of metricButtons) {
      button.classList.toggle('active', button.dataset.metric === 'download');
    }
    setGauge('download', metricValues.download);
  } catch (error) {
    console.error(error);
    setStatus(`Ошибка: ${error.message}`);
  } finally {
    setBusy(false);
  }
});

ensureGaugeReady();
setSelectedMetric('download', { force: true });
loadIpInfo();
