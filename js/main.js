let bleDevice, gattServer;
let epdService, epdCharacteristic;
let otaService, otaTxCharacteristic, otaRxCharacteristic, otaControlCharacteristic;
let otaReceiveBuffer = new Uint8Array(0);
let otaPendingResponse = null;
let otaPendingSignal = null;
let otaSelectedPackage = null;
let otaBusy = false;
let otaFinalizing = false;
let otaCompletedAwaitingRestart = false;
let otaTransferStats = null;
let otaExpectedActivationState = null;
let otaVerificationPending = false;
let deviceActivationState = null;
let activationStateWaiters = [];
let bootloaderMode = false;
let activationSubmitPending = false;
let activationResetExpected = false;
let activationReconnectSyncPending = false;
let startTime, msgIndex, appVersion;
let canvas, ctx, textDecoder;
let ditherPreviewFrame = 0;
let ditherSourceImageData = null;
let paintManager, cropManager;
let rleSupport;
let ledEnabled = false;
let batteryWarningLevel = 0;
let lastBatteryStatus = null;
let ledWriteChain = Promise.resolve();
let slotStreamSupport = false;
let slotActionPending = false;
let slotPrepareWait = null;
let slotReadState = null;
let slotReadTimer = null;
let slotState = { count: 0, pageStart: 0, pageCount: 0, usedMask: 0, selected: null, flashSize: 0, fingerprints: [] };
const slotPreviewCache = new Map();
let timeSampleWaiter = null;
let timeMeasurementBusy = false;
let lastDeviceTimeSample = null;

// Firmware stores local wall-clock fields in a timezone-neutral timestamp.
function localWallClockMs(date = new Date()) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}

function formatWallClockTime(seconds) {
  const date = new Date(Number(seconds) * 1000);
  if (!Number.isFinite(date.getTime())) return '--:--:--';
  return [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map(value => String(value).padStart(2, '0')).join(':');
}

function updateTimeReadouts() {
  const system = document.getElementById('systemTimeReadout');
  const device = document.getElementById('deviceTimeReadout');
  const now = new Date();
  if (system) system.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  if (device && lastDeviceTimeSample) {
    const value = lastDeviceTimeSample.unix + ((performance.now() - lastDeviceTimeSample.receivedAt) / 1000);
    device.textContent = formatWallClockTime(value);
  }
}

if (typeof document !== 'undefined' && typeof setInterval === 'function') {
  setInterval(updateTimeReadouts, 250);
  updateTimeReadouts();
}

function createSerialQueue() {
  let tail = Promise.resolve();
  return operation => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
}

function shouldSyncAfterActivation(message, pending) {
  return pending && message.startsWith('activation=1');
}


let enqueueGattWrite = createSerialQueue();

const SLOT_PAGE_SIZE = 18;
const SLOT_READ_TIMEOUT_MS = 8000;
const SLOT_READ_MAX_RETRIES = 2;

const OTA_SERVICE_UUID = 'a6ed0401-d344-460a-8075-b9e8ec90d71b';
const OTA_TX_UUID = 'a6ed0402-d344-460a-8075-b9e8ec90d71b';
const OTA_RX_UUID = 'a6ed0403-d344-460a-8075-b9e8ec90d71b';
const OTA_CONTROL_UUID = 'a6ed0404-d344-460a-8075-b9e8ec90d71b';
const OTA_APPLICATION_ADDRESS = 0x01020000;
const OTA_SAVE_ADDRESS = 0x01050000;
const OTA_NVDS_ADDRESS = 0x0107F000;
const OTA_IMAGE_INFO_SIZE = 40;
const OTA_TAIL_SIZE = 48;
// MTU 244 leaves 241 ATT bytes. The DFU frame and PROGRAM_FLASH payload use
// 15 bytes, so 226 bytes is the largest firmware chunk that fits one write.
const OTA_CHUNK_SIZE = 226;
// Fast DFU sends raw ATT payloads after erase; MTU 244 leaves 241 bytes.
const OTA_FAST_CHUNK_SIZE = 241;
const OTA_MAX_RESPONSE_PAYLOAD = 512;
const OTA_ACTIVATION_MARKERS = ['locked=activation_required', 'activation=already'];

const DfuCmd = {
  GET_INFO: 0x01,
  PROGRAM_START: 0x23,
  PROGRAM_FLASH: 0x24,
  PROGRAM_END: 0x25,
  SYSTEM_INFO: 0x27,
  DFU_MODE_SET: 0x41,
  DFU_FW_INFO_GET: 0x42,
};

const EpdCmd = {
  SET_PINS: 0x00,
  INIT: 0x01,
  CLEAR: 0x02,
  SEND_CMD: 0x03,
  SEND_DATA: 0x04,
  REFRESH: 0x05,
  SLEEP: 0x06,

  SET_TIME: 0x20,
  SET_WEEK_START: 0x21,
  SET_THEME: 0x22,
  SET_LED: 0x23,
  GET_ACTIVATION: 0x24,
  ACTIVATE: 0x25,
  GET_STATUS: 0x2B,
  GET_TIME: 0x2A,

  WRITE_IMG: 0x30, // v1.6
  SET_SLOT: 0x31,
  FREE_SLOT: 0x32,
  SET_SLIDE: 0x33,
  GET_IMAGE: 0x34,
  GET_SLOTS: 0x35,

  SET_CONFIG: 0x90,
  SYS_RESET: 0x91,
  SYS_SLEEP: 0x92,
  CFG_ERASE: 0x99,
};

function setActivationPanelVisible(visible) {
  const panel = document.getElementById('activationPanel');
  if (panel) panel.hidden = !visible;
}

function updateBatteryStatus(voltage, battery, temperature) {
  const el = document.getElementById('batteryStatus');
  if (!el) return;
  const mv = Number(voltage);
  const pct = Math.max(1, Math.min(100, Number(battery)));
  if (!Number.isFinite(mv) || !Number.isFinite(pct)) {
    el.textContent = '电量 --';
    el.title = '设备电池电量暂不可用';
    return;
  }
  const volts = (mv / 1000).toFixed(2);
  lastBatteryStatus = { voltage: mv, battery: pct, temperature: Number(temperature) };
  el.textContent = `电量 ${pct}% · ${volts}V`;
  const tempText = Number(temperature) === -1 ? '温度不可用' : (Number.isFinite(Number(temperature)) ? `温度 ${temperature}℃` : '');
  el.title = `电池 ${volts}V（${mv} mV）${tempText ? `，${tempText}` : ''}`;
  el.classList.toggle('battery-low', pct <= 20);
  const warningLevel = mv <= 2700 || pct <= 5 ? 2 : (mv <= 2850 || pct <= 15 ? 1 : 0);
  el.classList.toggle('battery-critical', warningLevel === 2);
  if (warningLevel !== batteryWarningLevel) {
    if (warningLevel === 2) addLog(`严重低电量提醒：${pct}%（${volts}V），已接近墨水屏最低刷新电压 2.70V`);
    else if (warningLevel === 1) addLog(`低电量提醒：${pct}%（${volts}V），请及时充电`);
    batteryWarningLevel = warningLevel;
  }
}

async function refreshBatteryStatus() {
  const el = document.getElementById('batteryStatus');
  if (!epdCharacteristic || !gattServer || !gattServer.connected) {
    if (el) el.title = '请先连接设备';
    addLog('请先连接设备后再刷新电量');
    return false;
  }
  if (el) el.title = '正在读取电池电量...';
  const ok = await write(EpdCmd.GET_STATUS);
  if (ok && el) el.title = '已发送刷新请求，等待设备返回';
  return ok;
}

async function queryActivation() {
  const ok = await write(EpdCmd.GET_ACTIVATION);
  if (ok) document.getElementById('activationStatus').textContent = '正在读取设备激活状态...';
}

async function submitActivationCode() {
  const input = document.getElementById('activationCode');
  const compact = input.value.replace(/[^0-9a-f]/gi, '');
  if (compact.length !== 418) {
    document.getElementById('activationStatus').textContent = '激活证书应为 418 位十六进制字符';
    return;
  }
  const certificate = hex2bytes(compact);
  await sendActivationCertificate(certificate, '设备激活输入框');
}

async function sendActivationCertificate(certificate, source) {
  activationSubmitPending = true;
  activationResetExpected = false;
  const ok = await write(EpdCmd.ACTIVATE, certificate);
  if (ok) {
    document.getElementById('activationStatus').textContent = '激活证书已发送，等待设备验证';
    addLog(`已通过${source}提交激活码`);
  } else if (activationSubmitPending) {
    document.getElementById('activationStatus').textContent = '设备可能已接受证书并正在重启，请重新连接确认';
    addLog('激活写确认因设备复位中断，请重新连接读取激活状态');
  }
  return ok;
}

function encodeSlotIndex(slot) {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, slot >>> 0, true);
  return payload;
}

function encodeSlotAction(action, slot) {
  const payload = new Uint8Array(5);
  payload[0] = action;
  new DataView(payload.buffer).setUint32(1, slot >>> 0, true);
  return payload;
}

function normalizeSlotFingerprint(value) {
  if (!/^[0-9a-f]{1,8}$/i.test(String(value || ''))) return null;
  return String(value).padStart(8, '0').toLowerCase();
}

function parseSlotsMessage(message) {
  const parts = message.trim().split(/\s+/);
  const match = /^slots=(\d+)$/.exec(parts[0] || '');
  if (!match || parts.length < 6) return null;
  const pageCount = Number(parts[2]);
  const selected = Number(parts[4]);
  return {
    count: Number(match[1]),
    pageStart: Number(parts[1]),
    pageCount,
    usedMask: Number(parts[3]),
    selected: selected === 0xFFFFFFFF ? null : selected,
    flashSize: Number(parts[5]),
    fingerprints: parts.slice(6, 6 + pageCount).map(normalizeSlotFingerprint),
  };
}

function parseImageMetadata(message) {
  const match = /^img=(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(message.trim());
  if (!match) return null;
  return { slot: Number(match[1]), width: Number(match[2]), height: Number(match[3]),
    size: Number(match[4]), color: Number(match[5]), chunkSize: Number(match[6]) };
}

function slotPageStart(current, direction, count) {
  if (count <= SLOT_PAGE_SIZE) return 0;
  return Math.max(0, Math.min(Math.floor((count - 1) / SLOT_PAGE_SIZE) * SLOT_PAGE_SIZE,
    current + direction * SLOT_PAGE_SIZE));
}

function slotControlsDisabled(connected, isBootloader, busy) {
  return !connected || isBootloader || busy;
}

function assembleSlotChunk(parts, expectedLength) {
  const actualLength = parts.reduce((total, part) => total + part.length, 0);
  if (actualLength !== expectedLength) throw new Error('slot chunk length mismatch');
  const result = new Uint8Array(expectedLength);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

const canvasSizes = [
  { name: '1.54_152_152', width: 152, height: 152 },
  { name: '1.54_200_200', width: 200, height: 200 },
  { name: '2.13_104_212', width: 104, height: 212 },
  { name: '2.13_122_250', width: 122, height: 250 },
  { name: '2.13_250_122', width: 250, height: 122 },
  { name: '2.66_152_296', width: 152, height: 296 },
  { name: '2.66_184_360', width: 184, height: 360 },
  { name: '2.9_128_296', width: 128, height: 296 },
  { name: '2.9_168_384', width: 168, height: 384 },
  { name: '3.5_184_384', width: 184, height: 384 },
  { name: '3.5_360_600', width: 360, height: 600 },
  { name: '3.7_240_416', width: 240, height: 416 },
  { name: '3.7_280_480', width: 280, height: 480 },
  { name: '3.97_800_480', width: 800, height: 480 },
  { name: '3.98_768_552', width: 768, height: 552 },
  { name: '4.2_400_300', width: 400, height: 300 },
  { name: '5.79_792_272', width: 792, height: 272 },
  { name: '5.83_600_448', width: 600, height: 448 },
  { name: '5.83_648_480', width: 648, height: 480 },
  { name: '7.5_640_384', width: 640, height: 384 },
  { name: '7.5_800_480', width: 800, height: 480 },
  { name: '7.5_880_528', width: 880, height: 528 },
  { name: '10.2_960_640', width: 960, height: 640 },
  { name: '10.85_1360_480', width: 1360, height: 480 },
  { name: '11.6_960_640', width: 960, height: 640 },
  { name: '4.0E6_600_400', width: 600, height: 400 },
  { name: '7.3E6_800_480', width: 800, height: 480 },
];

function hex2bytes(hex) {
  for (var bytes = [], c = 0; c < hex.length; c += 2)
    bytes.push(parseInt(hex.substr(c, 2), 16));
  return new Uint8Array(bytes);
}

function bytes2hex(data) {
  return new Uint8Array(data).reduce(
    function (memo, i) {
      return memo + ("0" + i.toString(16)).slice(-2);
    }, "");
}

function intToHex(intIn) {
  let stringOut = ("0000" + intIn.toString(16)).substr(-4)
  return stringOut.substring(2, 4) + stringOut.substring(0, 2);
}

function resetVariables() {
  for (const resolve of activationStateWaiters) resolve(null);
  activationStateWaiters = [];
  deviceActivationState = null;
  if (otaPendingResponse) {
    clearTimeout(otaPendingResponse.timer);
    const error = new Error('蓝牙连接已断开');
    error.otaRestartExpected = otaFinalizing;
    otaPendingResponse.reject(error);
    otaPendingResponse = null;
  }
  if (otaPendingSignal) {
    clearTimeout(otaPendingSignal.timer);
    otaPendingSignal.reject(new Error('蓝牙连接已断开'));
    otaPendingSignal = null;
  }
  gattServer = null;
  epdService = null;
  epdCharacteristic = null;
  otaService = null;
  otaTxCharacteristic = null;
  otaRxCharacteristic = null;
  otaControlCharacteristic = null;
  otaReceiveBuffer = new Uint8Array(0);
  otaBusy = false;
  otaFinalizing = false;
  otaCompletedAwaitingRestart = false;
  bootloaderMode = false;
  msgIndex = 0;
  rleSupport = false;
  slotStreamSupport = false;
  slotActionPending = false;
  if (slotPrepareWait) {
    clearTimeout(slotPrepareWait.timer);
    slotPrepareWait.resolve(false);
    slotPrepareWait = null;
  }
  if (slotReadTimer) clearTimeout(slotReadTimer);
  slotReadTimer = null;
  slotReadState = null;
  slotState = { count: 0, pageStart: 0, pageCount: 0, usedMask: 0, selected: null, flashSize: 0, fingerprints: [] };
  renderSlotGrid();
  updateBatteryStatus(NaN, NaN, NaN);
  enqueueGattWrite = createSerialQueue();
  setActivationPanelVisible(false);
  document.getElementById("log").value = '';
}

async function write(cmd, data, withResponse = true) {
  const characteristic = epdCharacteristic;
  if (!characteristic) {
    addLog("服务不可用，请检查蓝牙连接");
    return false;
  }
  let payload = [cmd];
  if (data) {
    if (typeof data == 'string') data = hex2bytes(data);
    if (data instanceof Uint8Array) data = Array.from(data);
    payload.push(...data)
  }
  const bytes = Uint8Array.from(payload);
  return enqueueGattWrite(async () => {
    if (characteristic !== epdCharacteristic || !gattServer || !gattServer.connected) return false;
    addLog(bytes2hex(bytes), '⇑');
    try {
      if (withResponse)
        await characteristic.writeValueWithResponse(bytes);
      else
        await characteristic.writeValueWithoutResponse(bytes);
    } catch (e) {
      console.error(e);
      if (e.message) addLog("write: " + e.message);
      return false;
    }
    return true;
  });
}

async function writeImage(data, step = 'bw') {
  const chunkSize = document.getElementById('mtusize').value - 2;
  const interleavedCount = document.getElementById('interleavedcount').value;
  let noReplyCount = interleavedCount;
  let totalRleLength = 0;
  const stepText = step === 'bw' ? '数据块' : '红色块';

  // Use RLE only when its complete encoded stream is smaller than the
  // original data. Each RLE chunk contains complete codes.
  const rleChunks = rleSupport ? rleCompressMTU(data, chunkSize) : null;
  const rleLength = rleChunks ? rleChunks.reduce((total, chunk) => total + chunk.length, 0) : data.length;
  const useRle = rleSupport && rleLength < data.length;
  const totalChunks = useRle ? rleChunks.length : Math.ceil(data.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    let chunk;
    if (useRle) {
      chunk = rleChunks[i];
      totalRleLength += chunk.length;
    } else {
      const off = i * chunkSize;
      chunk = data.slice(off, off + chunkSize);
    }

    const currentTime = (new Date().getTime() - startTime) / 1000.0;
    setStatus(`${stepText}: ${i + 1}/${totalChunks}, 总用时: ${currentTime}s`);

    const payload = [
      rleSupport
        ?
        (step === 'bw' ? 0x00 : 0x01) | (i === 0 ? 0x02 : 0x00) | (useRle ? 0x04 : 0x00)
        :
        (step === 'bw' ? 0x0F : 0x00) | (i === 0 ? 0x00 : 0xF0)
      ,
      ...chunk,
    ];
    if (noReplyCount > 0) {
      if (!await write(EpdCmd.WRITE_IMG, payload, false)) return false;
      noReplyCount--;
    } else {
      if (!await write(EpdCmd.WRITE_IMG, payload, true)) return false;
      noReplyCount = interleavedCount;
    }
  }
  return true;
}

async function setDriver() {
  await write(EpdCmd.SET_PINS, document.getElementById("epdpins").value);
  await write(EpdCmd.INIT, document.getElementById("epddriver").value);
}

async function syncTime(mode) {
  if (mode === 2) {
    if (!confirm('提醒：时钟模式目前使用全刷实现，此功能目前多用于修复老化屏残影问题，不建议长期开启，是否继续？')) return;
  }
  const sample = await requestTimeSample();
  // SET_TIME carries whole seconds. Estimate write latency from a GET_TIME
  // round trip and choose the nearest wall-clock second at device reception.
  const timestamp = Math.round(localWallClockMs() / 1000 + (sample ? sample.rttMs / 2000 : 0));
  const data = new Uint8Array([
    (timestamp >> 24) & 0xFF,
    (timestamp >> 16) & 0xFF,
    (timestamp >> 8) & 0xFF,
    timestamp & 0xFF,
    0,
    mode
  ]);
  if (await write(EpdCmd.SET_TIME, data)) {
    addLog("时间已同步！");
    addLog("屏幕刷新完成前请不要操作。");
  }
}

function localUnixSeconds() {
  return Math.floor(localWallClockMs() / 1000);
}

function resolveTimeSample(rawSeconds) {
  const normalized = Number(rawSeconds);
  lastDeviceTimeSample = { raw: Number(rawSeconds), unix: normalized, receivedAt: performance.now() };
  if (timeSampleWaiter) {
    const waiter = timeSampleWaiter;
    timeSampleWaiter = null;
    waiter.resolve(lastDeviceTimeSample);
  }
}

function waitForTimeSample(timeoutMs = 6000) {
  if (timeSampleWaiter) return Promise.resolve(null);
  return new Promise(resolve => {
    const waiter = { resolve: value => { clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => {
      if (timeSampleWaiter !== waiter) return;
      timeSampleWaiter = null;
      resolve(null);
    }, timeoutMs);
    timeSampleWaiter = waiter;
  });
}

async function requestTimeSample() {
  if (!epdCharacteristic || !gattServer?.connected || bootloaderMode) return null;
  let sample = null;
  let sentAt = 0;
  for (let attempt = 0; attempt < 3 && !sample; attempt++) {
    const wait = waitForTimeSample(6000);
    sentAt = performance.now();
    // The firmware handles GET_TIME as a notification-triggering command;
    // keep this as a write without response. Confirmed writes can be held by
    // the peripheral while a display refresh is active and produce no t= reply.
    if (!await write(EpdCmd.GET_TIME, new Uint8Array(0), false)) {
      timeSampleWaiter = null;
      return null;
    }
    sample = await wait;
    if (!sample && attempt < 2) await delay(250);
  }
  if (!sample) return null;
  const receivedAt = sample.receivedAt;
  // Compare against the local wall-clock representation used by firmware.
  const midpoint = (localWallClockMs() / 1000) + (receivedAt - sentAt) / 2000;
  // The firmware exposes whole seconds. Treat the reported second as the
  // center of its one-second interval so truncation is not reported as drift.
  return { ...sample, errorMs: (sample.unix + 0.5 - midpoint) * 1000, rttMs: receivedAt - sentAt };
}

async function measureDeviceClock() {
  if (timeMeasurementBusy) return;
  timeMeasurementBusy = true;
  const status = document.getElementById('timeCalibrationStatus');
  if (status) status.textContent = '正在采样设备时钟...';
  const samples = [];
  try {
    for (let i = 0; i < 8; i++) {
      const sample = await requestTimeSample();
      if (sample) samples.push(sample);
      if (i < 7) await new Promise(resolve => setTimeout(resolve, 180));
    }
    if (!samples.length) throw new Error('设备未返回时间，请确认固件支持时间读取');
    const errors = samples.map(s => s.errorMs);
    const average = errors.reduce((a, b) => a + b, 0) / errors.length;
    const min = Math.min(...errors), max = Math.max(...errors);
    const text = `误差 ${average >= 0 ? '+' : ''}${average.toFixed(0)} ms · 范围 ${min.toFixed(0)}~${max.toFixed(0)} ms · ${samples.length} 次`;
    if (status) status.textContent = text;
    addLog(`时钟测量：${text}，平均往返 ${(samples.reduce((a, s) => a + s.rttMs, 0) / samples.length).toFixed(0)} ms`);
  } catch (error) {
    if (status) status.textContent = `测量失败：${error.message}`;
    addLog(`时钟测量失败：${error.message}`);
  } finally { timeMeasurementBusy = false; }
}

async function calibrateDeviceTime() {
  if (!epdCharacteristic || !gattServer?.connected || bootloaderMode) {
    addLog('请先连接应用固件设备后再校准时间');
    return;
  }
  const status = document.getElementById('timeCalibrationStatus');
  const started = performance.now();
  if (status) status.textContent = '正在校准设备时间...';
  const before = await requestTimeSample();
  if (status) status.textContent = '正在读取设备时间（约 6 秒）...';
  // Crystal compensation is intentionally neutral; a short read window is
  // sufficient for the manual/current-time correction.
  await new Promise(resolve => setTimeout(resolve, 6000));
  const driftSample = await requestTimeSample();
  const elapsed = before && driftSample ? Math.max(1, (driftSample.receivedAt - before.receivedAt) / 1000) : 0;
  // GET_TIME has one-second resolution; endpoint differences are dominated by
  // quantization and cannot yield a trustworthy crystal slope. Keep the
  // persistent compensation neutral and correct the wall-clock instant only.
  const ppm = 0;
  const view = new DataView(new ArrayBuffer(4)); view.setInt32(0, ppm);
  const calibratedTarget = Math.round(localWallClockMs() / 1000 + (driftSample ? driftSample.rttMs / 2000 : 0));
  const data = new Uint8Array([ (calibratedTarget >> 24) & 0xFF, (calibratedTarget >> 16) & 0xFF, (calibratedTarget >> 8) & 0xFF, calibratedTarget & 0xFF, 0, 1, view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3) ]);
  if (!await write(EpdCmd.SET_TIME, data, true)) {
    if (status) status.textContent = '校准失败：写入未确认';
    return;
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  const after = await requestTimeSample();
  if (!after) { if (status) status.textContent = '已发送校准，等待设备返回超时'; return; }
  const beforeText = before ? `${before.errorMs >= 0 ? '+' : ''}${before.errorMs.toFixed(0)} ms` : '未读取';
  const afterText = `${after.errorMs >= 0 ? '+' : ''}${after.errorMs.toFixed(0)} ms`;
  if (status) status.textContent = `已校准 · 频率补偿 ${ppm >= 0 ? '+' : ''}${ppm} ppm · 当前 ${afterText}`;
  addLog(`时间校准完成：校准前 ${beforeText}，当前 ${afterText}，晶振补偿 ${ppm >= 0 ? '+' : ''}${ppm} ppm，耗时 ${((performance.now() - started) / 1000).toFixed(2)} s`);
}

async function applyManualTimeOffset() {
  if (!epdCharacteristic || !gattServer?.connected || bootloaderMode) {
    addLog('请先连接应用固件设备后再应用手动时间补偿');
    return;
  }
  const input = document.getElementById('manualTimeOffset');
  const status = document.getElementById('timeCalibrationStatus');
  const button = document.getElementById('applyManualTimeOffsetButton');
  const offset = Number(input?.value);
  if (!Number.isInteger(offset) || offset < -60 || offset > 60) {
    if (status) status.textContent = '补偿范围必须是 -60 到 +60 秒';
    return;
  }
  if (button) button.disabled = true;
  if (status) status.textContent = `正在应用 ${offset >= 0 ? '+' : ''}${offset} 秒补偿...`;
  try {
    const target = Math.round(localWallClockMs() / 1000) + offset;
    const data = new Uint8Array([
      (target >> 24) & 0xFF, (target >> 16) & 0xFF,
      (target >> 8) & 0xFF, target & 0xFF,
      0, 1, 0, 0, 0, 0,
    ]);
    if (!await write(EpdCmd.SET_TIME, data, true)) throw new Error('设备未确认时间写入');
    await delay(250);
    const sample = await requestTimeSample();
    const measured = sample ? sample.errorMs.toFixed(0) : '未读取';
    if (status) status.textContent = `手动补偿已应用 ${offset >= 0 ? '+' : ''}${offset} 秒 · 当前误差 ${measured} ms`;
    addLog(`手动时间补偿已应用：${offset >= 0 ? '+' : ''}${offset} 秒，当前误差 ${measured} ms`);
  } catch (error) {
    if (status) status.textContent = `手动补偿失败：${error.message}`;
    addLog(`手动时间补偿失败：${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function setCalendarTheme(theme) {
  const value = Number(theme);
  const calendarThemeNames = ['标准布局', '分栏大日期', '经典月历', '日期双栏', '一周焦点', '极简日历'];
  if (!Number.isInteger(value) || value < 0 || value > 5) return;
  if (await write(EpdCmd.SET_THEME, [value])) {
    addLog(`日历主题已切换: ${calendarThemeNames[value]}`);
    addLog("屏幕刷新完成前请不要操作。");
  }
}

function applyCalendarTheme() {
  const theme = document.getElementById('calendarTheme');
  if (theme) setCalendarTheme(theme.value);
}

async function setWeekStart(value) {
  const weekStart = Number(value);
  if (Number.isInteger(weekStart) && weekStart >= 0 && weekStart < 7)
    await write(EpdCmd.SET_WEEK_START, [weekStart]);
}

async function setLed(enabled) {
  const board = Number(document.getElementById('ledBoardRevision').value);
  const color = Number(document.getElementById('ledColor').value);
  const brightness = Number(document.getElementById('ledBrightness').value);
  const colorNames = { 1: '红色', 2: '绿色', 3: '黄色', 4: '蓝色', 5: '紫色', 6: '青色', 7: '白色' };
  ledEnabled = enabled;
  const toggleButton = document.getElementById('ledToggleButton');
  if (toggleButton) {
    toggleButton.textContent = enabled ? 'LED 关' : 'LED 开';
    toggleButton.classList.toggle('primary', !enabled);
    toggleButton.classList.toggle('danger', enabled);
    toggleButton.setAttribute('aria-pressed', String(enabled));
  }
  ledWriteChain = ledWriteChain.then(async () => {
    if (await write(EpdCmd.SET_LED, [board, enabled ? 1 : 0, color, brightness]))
      addLog(`V${board === 11 ? '1.1' : '1.2'} ${colorNames[color]} LED ${enabled ? '已开启' : '已关闭'}`);
  });
  await ledWriteChain;
}

function toggleLed() { void setLed(!ledEnabled); }

function applyLedSelection() { void setLed(ledEnabled); }

function updateLedBrightnessLabel() {
  document.getElementById('ledBrightnessValue').textContent = `${document.getElementById('ledBrightness').value}%`;
}

function toggleLedBrightness() {
  const panel = document.getElementById('ledBrightnessPanel');
  const button = document.getElementById('ledBrightnessButton');
  panel.hidden = !panel.hidden;
  button.setAttribute('aria-expanded', String(!panel.hidden));
}

async function clearScreen() {
  if (confirm('确认清除屏幕内容?')) {
    await write(EpdCmd.CLEAR);
    addLog("清屏指令已发送！");
    addLog("屏幕刷新完成前请不要操作。");
  }
}

function formatFlashSize(bytes) {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KiB` : `${bytes} B`;
}

function isSlotUsed(slot) {
  const bit = slot - slotState.pageStart;
  return bit >= 0 && bit < slotState.pageCount && ((slotState.usedMask >>> bit) & 1) !== 0;
}

function slotCacheKey(slot) {
  return `gr_epd_slot:${bleDevice && bleDevice.id ? bleDevice.id : 'unknown'}:${slot}`;
}

function readSlotCache(slot) {
  const relative = slot - slotState.pageStart;
  const fingerprint = relative >= 0 ? slotState.fingerprints[relative] : null;
  if (slotPreviewCache.has(slot)) {
    const memory = slotPreviewCache.get(slot);
    if (memory.fingerprint === fingerprint) return memory;
    if (memory.fingerprint == null && fingerprint != null && isSlotUsed(slot)) {
      writeSlotCache(slot, memory.dataUrl, memory.width, memory.height, memory.color, fingerprint);
      return slotPreviewCache.get(slot);
    }
    slotPreviewCache.delete(slot);
  }
  try {
    const cached = JSON.parse(localStorage.getItem(slotCacheKey(slot)) || 'null');
    if (cached && cached.fingerprint === fingerprint) {
      slotPreviewCache.set(slot, cached);
      return cached;
    }
  } catch (error) {
    console.warn('槽位缓存读取失败', error);
  }
  return null;
}

function writeSlotCache(slot, dataUrl, width, height, color, fingerprint = null) {
  const cached = { dataUrl, width, height, color, fingerprint };
  slotPreviewCache.set(slot, cached);
  try { localStorage.setItem(slotCacheKey(slot), JSON.stringify(cached)); } catch (error) {
    console.warn('槽位缓存保存失败', error);
  }
}

function removeSlotCache(slot) {
  slotPreviewCache.delete(slot);
  try { localStorage.removeItem(slotCacheKey(slot)); } catch (error) { console.warn(error); }
}

function renderSlotGrid() {
  const grid = document.getElementById('slotGrid');
  const summary = document.getElementById('slotSummary');
  const hint = document.getElementById('slotHint');
  const pagination = document.getElementById('slotPagination');
  grid.replaceChildren();
  if (slotState.count === 0) {
    const empty = document.createElement('div');
    empty.className = 'slot-empty';
    empty.textContent = '设备未识别到可用外置 Flash';
    grid.appendChild(empty);
    summary.textContent = '无可用图片槽';
    hint.textContent = '未检测到外置存储';
    pagination.hidden = true;
    return;
  }
  const disabled = slotControlsDisabled(!!(gattServer && gattServer.connected), bootloaderMode,
    slotActionPending || otaBusy);
  const end = Math.min(slotState.count, slotState.pageStart + slotState.pageCount);
  for (let slot = slotState.pageStart; slot < end; slot++) {
    const used = isSlotUsed(slot);
    const item = document.createElement('div');
    item.className = `slot-item${slotState.selected === slot ? ' selected' : ''}`;
    const cached = used ? readSlotCache(slot) : null;
    const preview = cached ? document.createElement('img') : document.createElement('div');
    preview.className = `slot-preview${cached ? '' : ' empty'}`;
    if (cached) { preview.src = cached.dataUrl; preview.alt = `槽位 ${slot + 1} 预览`; }
    else preview.textContent = used ? '待读取' : '空';
    const content = document.createElement('div');
    content.className = 'slot-content';
    const label = document.createElement('div');
    label.className = 'slot-label';
    const title = document.createElement('strong');
    title.textContent = `槽位 ${slot + 1}`;
    const state = document.createElement('span');
    state.className = 'slot-state';
    state.textContent = `${used ? '已存图片' : '空闲'}${slotState.selected === slot ? ' · 当前' : ''}`;
    label.append(title, state);
    const actions = document.createElement('div');
    actions.className = 'slot-actions';
    const specs = [
      [used ? '覆盖' : '存入', 'primary', () => saveImageToSlot(slot), false],
      ['显示', 'secondary', () => displayImageSlot(slot), !used],
      ['读取', 'secondary', () => readImageSlot(slot), !used],
      ['删除', 'danger', () => freeImageSlot(slot), !used],
    ];
    for (const [text, className, action, unavailable] of specs) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = className; button.textContent = text;
      button.disabled = disabled || unavailable;
      button.addEventListener('click', action);
      actions.appendChild(button);
    }
    content.append(label, actions);
    item.append(preview, content);
    grid.appendChild(item);
  }
  const page = Math.floor(slotState.pageStart / SLOT_PAGE_SIZE) + 1;
  const pages = Math.ceil(slotState.count / SLOT_PAGE_SIZE);
  summary.textContent = `${formatFlashSize(slotState.flashSize)} · ${slotState.count} 个槽位`;
  hint.textContent = `第 ${page}/${pages} 页 · 每槽按当前屏幕帧长动态划分`;
  pagination.hidden = pages <= 1;
  document.getElementById('slotPageStatus').textContent = `${page} / ${pages}`;
  document.getElementById('slotPrevPage').disabled = disabled || slotState.pageStart === 0;
  document.getElementById('slotNextPage').disabled = disabled || end >= slotState.count;
}

async function refreshSlots(start = slotState.pageStart) {
  if (!gattServer || !gattServer.connected || bootloaderMode) return false;
  document.getElementById('slotReadStatus').textContent = '正在读取槽位信息...';
  return write(EpdCmd.GET_SLOTS, encodeSlotIndex(Math.max(0, start)));
}

async function changeSlotPage(direction) {
  return refreshSlots(slotPageStart(slotState.pageStart, direction, slotState.count));
}

function waitForSlotReady(slot) {
  if (slotPrepareWait) return Promise.resolve(false);
  return new Promise(resolve => {
    const wait = { slot, resolve, timer: null };
    wait.timer = setTimeout(() => {
      if (slotPrepareWait !== wait) return;
      slotPrepareWait = null;
      resolve(false);
    }, 15000);
    slotPrepareWait = wait;
  });
}

async function prepareImageSlot(slot) {
  const ready = waitForSlotReady(slot);
  if (!await write(EpdCmd.SET_SLOT, encodeSlotAction(0, slot))) {
    clearTimeout(slotPrepareWait.timer);
    slotPrepareWait = null;
    return false;
  }
  return ready;
}

async function saveImageToSlot(slot) {
  const imageFile = document.getElementById('imageFile');
  if (!imageFile.files || imageFile.files.length === 0) {
    alert('请先选择图片。');
    return false;
  }
  if (isSlotUsed(slot) && !confirm(`槽位 ${slot + 1} 已有图片，确认覆盖？`)) return false;
  return sendimg({ slot, refreshAfterSave: document.getElementById('slotRefreshAfterSave').checked });
}

async function displayImageSlot(slot) {
  slotActionPending = true; updateButtonStatus(); renderSlotGrid();
  const ok = await write(EpdCmd.SET_SLOT, encodeSlotAction(1, slot));
  if (!ok) { slotActionPending = false; updateButtonStatus(); renderSlotGrid(); }
  return ok;
}

async function freeImageSlot(slot) {
  if (!confirm(`确认删除槽位 ${slot + 1}？`)) return false;
  slotActionPending = true; updateButtonStatus(); renderSlotGrid();
  const ok = await write(EpdCmd.FREE_SLOT, encodeSlotIndex(slot));
  if (!ok) { slotActionPending = false; updateButtonStatus(); renderSlotGrid(); }
  return ok;
}

async function freeAllImageSlots() {
  if (!confirm('确认擦除全部图片槽位？此操作不可恢复。')) return false;
  slotActionPending = true; updateButtonStatus(); renderSlotGrid();
  document.getElementById('slotReadStatus').textContent = '正在擦除全部槽位，请勿断开连接...';
  const ok = await write(EpdCmd.FREE_SLOT, encodeSlotIndex(0xFFFFFFFF));
  if (!ok) { slotActionPending = false; updateButtonStatus(); renderSlotGrid(); }
  return ok;
}

async function startSlotSlide(randomMode) {
  const minutes = Math.max(1, Math.min(65535, Number(document.getElementById('slotSlideMinutes').value) || 1));
  document.getElementById('slotSlideMinutes').value = minutes;
  return write(EpdCmd.SET_SLIDE, Uint8Array.of(minutes >> 8, minutes & 0xFF, randomMode ? 1 : 0));
}

async function stopSlotSlide() {
  return write(EpdCmd.SET_SLIDE, Uint8Array.of(0, 0));
}

async function readImageSlot(slot) {
  if (slotReadState) return false;
  slotReadState = { slot, pendingInfo: true, retries: 0 };
  document.getElementById('slotReadStatus').textContent = `正在读取槽位 ${slot + 1}...`;
  updateButtonStatus(); renderSlotGrid();
  return write(EpdCmd.GET_IMAGE, encodeSlotIndex(slot), false);
}

function armSlotReadTimeout() {
  if (slotReadTimer) clearTimeout(slotReadTimer);
  slotReadTimer = setTimeout(() => {
    if (!slotReadState) return;
    if (slotReadState.retries++ < SLOT_READ_MAX_RETRIES && !slotReadState.streaming) {
      const index = Math.floor(slotReadState.received / slotReadState.chunkSize);
      requestSlotChunk(index);
    } else {
      finishSlotRead(false, '槽位回读超时');
    }
  }, SLOT_READ_TIMEOUT_MS);
}

async function requestSlotChunk(index) {
  const request = new Uint8Array(6);
  request.set(encodeSlotIndex(slotReadState.slot));
  request[4] = (index >> 8) & 0xFF;
  request[5] = index & 0xFF;
  armSlotReadTimeout();
  return write(EpdCmd.GET_IMAGE, request, false);
}

function beginSlotRead(message) {
  const meta = parseImageMetadata(message);
  if (!meta || !slotReadState || meta.slot !== slotReadState.slot || meta.size <= 0 || meta.size > 1024 * 1024) return false;
  slotReadState = { ...meta, data: new Uint8Array(meta.size), received: 0, expected: null,
    retries: 0, streaming: slotStreamSupport };
  armSlotReadTimeout();
  if (slotStreamSupport) {
    const request = new Uint8Array(5);
    request.set(encodeSlotIndex(meta.slot)); request[4] = 1;
    void write(EpdCmd.GET_IMAGE, request, false);
  } else void requestSlotChunk(0);
  return true;
}

function beginSlotChunk(message) {
  if (!slotReadState || slotReadState.pendingInfo) return false;
  const match = /^chunk=(\d+)\s+len=(\d+)\s+rle=0$/.exec(message.trim());
  if (!match) return false;
  slotReadState.expected = { index: Number(match[1]), length: Number(match[2]), parts: [], received: 0 };
  armSlotReadTimeout();
  return true;
}

function receiveSlotChunk(data) {
  if (!slotReadState || !slotReadState.expected) return false;
  const expected = slotReadState.expected;
  if (expected.received + data.length > expected.length) { finishSlotRead(false, '槽位数据块长度异常'); return true; }
  expected.parts.push(data.slice()); expected.received += data.length;
  if (expected.received < expected.length) { armSlotReadTimeout(); return true; }
  const chunk = assembleSlotChunk(expected.parts, expected.length);
  const offset = expected.index * slotReadState.chunkSize;
  if (offset + chunk.length > slotReadState.data.length) { finishSlotRead(false, '槽位数据越界'); return true; }
  slotReadState.data.set(chunk, offset);
  slotReadState.received += chunk.length;
  slotReadState.expected = null;
  document.getElementById('slotReadStatus').textContent =
    `正在读取槽位 ${slotReadState.slot + 1}：${Math.round(slotReadState.received * 100 / slotReadState.size)}%`;
  if (slotReadState.received >= slotReadState.size) finishSlotRead(true);
  else if (!slotReadState.streaming) void requestSlotChunk(expected.index + 1);
  else armSlotReadTimeout();
  return true;
}

function finishSlotRead(success, message = '') {
  if (slotReadTimer) clearTimeout(slotReadTimer);
  slotReadTimer = null;
  const state = slotReadState;
  slotReadState = null;
  if (success && state) {
    try {
      const mode = state.color === 2 ? 'threeColor' : state.color === 3 ? 'fourColor' : 'blackWhiteColor';
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = state.width; previewCanvas.height = state.height;
      previewCanvas.getContext('2d').putImageData(decodeProcessedData(state.data, state.width, state.height, mode), 0, 0);
      const relative = state.slot - slotState.pageStart;
      writeSlotCache(state.slot, previewCanvas.toDataURL('image/jpeg', 0.82), state.width, state.height,
        state.color, relative >= 0 ? slotState.fingerprints[relative] : null);
      message = `槽位 ${state.slot + 1} 回读完成`;
    } catch (error) { message = `预览生成失败：${error.message || error}`; }
  }
  document.getElementById('slotReadStatus').textContent = message;
  updateButtonStatus(); renderSlotGrid();
}

async function sendcmd() {
  const input = document.getElementById('cmdTXT');
  const cmdTXT = input.value.trim();
  if (cmdTXT === '') return;
  input.value = '';
  if (!/^[0-9a-f\s-]+$/i.test(cmdTXT)) {
    addLog('命令或激活码只能包含十六进制字符');
    return;
  }
  const compact = cmdTXT.replace(/[\s-]/g, '');
  if (compact.length === 418) {
    const certificate = hex2bytes(compact);
    document.getElementById('activationCode').value = compact;
    await sendActivationCertificate(certificate, '发送命令输入框');
    return;
  }
  if (compact.length < 2 || compact.length % 2 !== 0) {
    addLog('原始命令必须是偶数位十六进制字符，激活码必须为 418 位');
    return;
  }
  const bytes = hex2bytes(compact);
  await write(bytes[0], bytes.length > 1 ? bytes.slice(1) : null);
}

function convertUC8159(blackWhiteData, redWhiteData) {
  const halfLength = blackWhiteData.length;
  let payloadData = new Uint8Array(halfLength * 4);
  let payloadIdx = 0;
  let black_data, color_data, data;
  for (let i = 0; i < halfLength; i++) {
    black_data = blackWhiteData[i];
    color_data = redWhiteData[i];
    for (let j = 0; j < 8; j++) {
      if ((color_data & 0x80) == 0x00) data = 0x04;  // red
      else if ((black_data & 0x80) == 0x00) data = 0x00;  // black
      else data = 0x03;  // white
      data = (data << 4) & 0xFF;
      black_data = (black_data << 1) & 0xFF;
      color_data = (color_data << 1) & 0xFF;
      j++;
      if ((color_data & 0x80) == 0x00) data |= 0x04;  // red
      else if ((black_data & 0x80) == 0x00) data |= 0x00;  // black
      else data |= 0x03;  // white
      black_data = (black_data << 1) & 0xFF;
      color_data = (color_data << 1) & 0xFF;
      payloadData[payloadIdx++] = data;
    }
  }
  return payloadData;
}

async function sendimg(options = {}) {
  // The current crop manager keeps transforms pending instead of exposing the
  // old isCropMode/finishCrop API. Commit any last pan/zoom before encoding.
  if (cropManager && cropManager.commitPendingTransform) cropManager.commitPendingTransform(true);

  const canvasSize = document.getElementById('canvasSize').value;
  const ditherMode = document.getElementById('ditherMode').value;
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];

  if (selectedOption.getAttribute('data-size') !== canvasSize) {
    if (!confirm("警告：画布尺寸和驱动不匹配，是否继续？")) return;
  }
  if (selectedOption.getAttribute('data-color') !== ditherMode) {
    if (!confirm("警告：颜色模式和驱动不匹配，是否继续？")) return;
  }

  startTime = new Date().getTime();
  const status = document.getElementById("status");
  status.parentElement.style.display = "block";

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = processImageData(imageData, ditherMode);
  const targetSlot = Number.isInteger(options.slot) ? options.slot : null;
  const refreshAfterSave = targetSlot != null && options.refreshAfterSave === true;

  updateButtonStatus(true);

  if (!await write(EpdCmd.INIT)) { updateButtonStatus(); return false; }
  if (targetSlot != null) {
    slotActionPending = true;
    if (!await prepareImageSlot(targetSlot)) {
      slotActionPending = false;
      updateButtonStatus(); renderSlotGrid();
      setStatus('槽位写入准备失败。');
      return false;
    }
    writeSlotCache(targetSlot, canvas.toDataURL('image/jpeg', 0.82), canvas.width, canvas.height,
      ditherMode === 'threeColor' ? 2 : ditherMode === 'fourColor' ? 3 : 1, null);
  }

  let transferOk = true;

  if (ditherMode === 'threeColor') {
    const halfLength = Math.floor(processedData.length / 2);
    const blackWhiteData = processedData.slice(0, halfLength);
    const redWhiteData = processedData.slice(halfLength);
    if (['08', '09', '0e', '0f'].includes(epdDriverSelect.value)) {
      transferOk = await writeImage(convertUC8159(blackWhiteData, redWhiteData), 'bw');
    } else {
      transferOk = await writeImage(blackWhiteData, 'bw');
      if (transferOk) transferOk = await writeImage(redWhiteData, 'red');
    }
  } else if (ditherMode === 'blackWhiteColor') {
    if (['08', '09', '0e', '0f'].includes(epdDriverSelect.value)) {
      const emptyData = new Uint8Array(processedData.length).fill(0xFF);
      transferOk = await writeImage(convertUC8159(processedData, emptyData), 'bw');
    } else {
      transferOk = await writeImage(processedData, 'bw');
    }
  } else if (ditherMode === 'fourColor' || ditherMode === 'sixColor') {
    transferOk = await writeImage(processedData, 'bw');
  } else {
    addLog("当前固件不支持此颜色模式。");
    updateButtonStatus();
    return false;
  }

  if (!transferOk) {
    if (targetSlot != null) await write(EpdCmd.SET_SLOT, encodeSlotAction(0, 0xFFFFFFFF));
    slotActionPending = false;
    updateButtonStatus(); renderSlotGrid();
    setStatus('图片发送失败。');
    return false;
  }

  const completionOk = targetSlot != null
    ? await write(EpdCmd.SET_SLOT, encodeSlotAction(refreshAfterSave ? 3 : 2, targetSlot))
    : await write(EpdCmd.REFRESH);
  if (!completionOk) {
    slotActionPending = false;
    updateButtonStatus(); renderSlotGrid();
    return false;
  }
  updateButtonStatus();

  const sendTime = (new Date().getTime() - startTime) / 1000.0;
  addLog(`${targetSlot != null ? '槽位数据发送完成' : '发送完成'}！耗时: ${sendTime}s`);
  setStatus(targetSlot != null ? '图片已发送，正在校验并提交槽位...' : `发送完成！耗时: ${sendTime}s`);
  if (targetSlot == null || refreshAfterSave) addLog("屏幕刷新完成前请不要操作。");
  setTimeout(() => {
    status.parentElement.style.display = "none";
  }, 5000);
  return true;
}

function downloadDataArray() {
  if (cropManager && cropManager.commitPendingTransform) cropManager.commitPendingTransform(true);

  const mode = document.getElementById('ditherMode').value;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = processImageData(imageData, mode);

  if (mode === 'sixColor' && processedData.length !== canvas.width * canvas.height) {
    console.log(`错误：预期${canvas.width * canvas.height}字节，但得到${processedData.length}字节`);
    addLog('数组大小不匹配。请检查图像尺寸和模式。');
    return;
  }

  const dataLines = [];
  for (let i = 0; i < processedData.length; i++) {
    const hexValue = (processedData[i] & 0xff).toString(16).padStart(2, '0');
    dataLines.push(`0x${hexValue}`);
  }

  const formattedData = [];
  for (let i = 0; i < dataLines.length; i += 16) {
    formattedData.push(dataLines.slice(i, i + 16).join(', '));
  }

  const colorModeValue = mode === 'sixColor' ? 0 : mode === 'fourColor' ? 1 : mode === 'blackWhiteColor' ? 2 : 3;
  const arrayContent = [
    'const uint8_t imageData[] PROGMEM = {',
    formattedData.join(',\n'),
    '};',
    `const uint16_t imageWidth = ${canvas.width};`,
    `const uint16_t imageHeight = ${canvas.height};`,
    `const uint8_t colorMode = ${colorModeValue};`
  ].join('\n');

  const blob = new Blob([arrayContent], { type: 'text/plain' });
  const link = document.createElement('a');
  link.download = 'imagedata.h';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateButtonStatus(forceDisabled = false) {
  const connected = gattServer != null && gattServer.connected;
  const epdReady = connected && epdCharacteristic && !forceDisabled && !otaBusy;
  document.getElementById("connectbutton").disabled = otaBusy;
  document.getElementById("reconnectbutton").disabled = otaBusy || bleDevice == null || connected;
  document.getElementById("sendcmdbutton").disabled = !epdReady;
  document.getElementById("calendarmodebutton").disabled = !epdReady;
  document.getElementById("clockmodebutton").disabled = !epdReady;
  document.getElementById("clearscreenbutton").disabled = !epdReady;
  document.getElementById("calendarThemeButton").disabled = !epdReady;
  document.getElementById("ledBoardRevision").disabled = !epdReady;
  document.getElementById("ledColor").disabled = !epdReady;
  const ledToggleButton = document.getElementById("ledToggleButton");
  if (ledToggleButton) ledToggleButton.disabled = !epdReady;
  document.getElementById("ledBrightnessButton").disabled = !epdReady;
  document.getElementById("ledBrightness").disabled = !epdReady;
  document.getElementById("sendimgbutton").disabled = !epdReady;
  const batteryStatus = document.getElementById('batteryStatus');
  if (batteryStatus) batteryStatus.disabled = !epdReady;
  document.getElementById("setDriverbutton").disabled = !epdReady;
  const otaReady = connected && otaRxCharacteristic && otaControlCharacteristic && otaSelectedPackage && !forceDisabled && !otaBusy;
  document.getElementById("otaUpgradeButton").disabled = !otaReady;
  document.getElementById("otaFile").disabled = otaBusy;
  document.getElementById("otaToggleButton").disabled = otaBusy;
  const slotDisabled = slotControlsDisabled(connected, bootloaderMode,
    forceDisabled || otaBusy || slotActionPending || slotReadState != null);
  for (const id of ['refreshSlotsButton', 'eraseAllSlotsButton', 'slotSlideMinutes',
    'startSequentialSlideButton', 'startRandomSlideButton', 'stopSlideButton']) {
    const control = document.getElementById(id);
    if (control) control.disabled = slotDisabled;
  }
}

function toggleOtaPanel() {
  const panel = document.getElementById('otaPanel');
  const button = document.getElementById('otaToggleButton');
  panel.hidden = !panel.hidden;
  button.setAttribute('aria-expanded', String(!panel.hidden));
  button.textContent = panel.hidden ? 'OTA 升级' : '收起 OTA';
}

function disconnect() {
  const wasBootloader = bootloaderMode;
  const otaRestartExpected = otaFinalizing || otaCompletedAwaitingRestart;
  const activationRestart = activationSubmitPending || activationResetExpected;
  activationSubmitPending = false;
  activationResetExpected = false;
  resetVariables();
  updateButtonStatus();
  addLog('已断开连接.');
  if (otaRestartExpected) {
    otaVerificationPending = true;
    setOtaProgress(100);
    setOtaStatus('OTA 传输已完成，设备正在重启并校验激活状态', 'success');
    addLog('OTA 结束阶段设备已断开，按正常重启处理');
    setTimeout(() => confirmOtaAfterReset(1), 1800);
  } else if (otaSelectedPackage) {
    setOtaStatus('设备已断开，请重新扫描 GR_EPD 或 Bootloader_OTA 后继续升级');
    if (wasBootloader) addLog('Bootloader OTA 已断开，请重新扫描 Bootloader_OTA 继续救援');
  } else {
    setOtaStatus('设备已断开');
  }
  document.getElementById("connectbutton").innerHTML = '连接';
  if (activationRestart) {
    activationReconnectSyncPending = true;
    document.getElementById('activationStatus').textContent = '设备已执行激活并重启，请重新连接确认状态';
    addLog('激活后设备正常复位，断开属于预期行为');
    setTimeout(() => confirmActivationAfterReset(1), 1800);
  }
}

async function waitForActivationState(timeoutMs = 3500) {
  if (!epdCharacteristic || !gattServer || !gattServer.connected) return null;
  deviceActivationState = null;
  let waiter;
  const response = new Promise(resolve => {
    waiter = resolve;
    activationStateWaiters.push(resolve);
  });
  if (!await write(EpdCmd.GET_ACTIVATION)) {
    activationStateWaiters = activationStateWaiters.filter(resolve => resolve !== waiter);
    return null;
  }
  const result = await Promise.race([
    response,
    new Promise(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  activationStateWaiters = activationStateWaiters.filter(resolve => resolve !== waiter);
  return result;
}

function recordActivationState(active) {
  deviceActivationState = active;
  const waiters = activationStateWaiters;
  activationStateWaiters = [];
  for (const resolve of waiters) resolve(active);
}

async function confirmOtaAfterReset(attempt) {
  if (!otaVerificationPending || !bleDevice) return;
  if (!gattServer || !gattServer.connected) {
    addLog(`正在自动重连确认 OTA 结果（${attempt}/3）`);
    await connect();
  }
  if (gattServer && gattServer.connected && epdCharacteristic) {
    const current = await waitForActivationState();
    if (current !== null) {
      otaVerificationPending = false;
      if (otaExpectedActivationState === null || current === otaExpectedActivationState) {
        const stateText = current ? '已激活' : '未激活';
        setOtaStatus(`OTA 升级完成，设备${stateText}状态已保留`, 'success');
        addLog(`OTA 后校验通过：设备仍为${stateText}`);
      } else {
        setOtaStatus('OTA 后激活状态与升级前不一致，请停止操作并检查 NVDS', 'error');
        addLog('OTA 激活保护告警：升级前后激活状态不一致');
      }
      return;
    }
  }
  if (attempt < 3) {
    setTimeout(() => confirmOtaAfterReset(attempt + 1), 1500 * attempt);
  } else {
    otaVerificationPending = false;
    setOtaStatus('OTA 传输已完成，但未能自动读取激活状态，请手动重连确认', 'error');
    addLog('OTA 后自动校验超时，请手动重连');
  }
}

async function confirmActivationAfterReset(attempt) {
  if (!bleDevice || (gattServer && gattServer.connected)) return;
  addLog(`正在自动重连确认激活状态（${attempt}/3）`);
  await connect();
  if (gattServer && gattServer.connected && epdCharacteristic) {
    await queryActivation();
    return;
  }
  if (attempt < 3) setTimeout(() => confirmActivationAfterReset(attempt + 1), 1500 * attempt);
  else {
    activationReconnectSyncPending = false;
    document.getElementById('activationStatus').textContent = '设备已重启，请手动重新连接并读取激活状态';
  }
}

async function preConnect() {
  if (gattServer != null && gattServer.connected) {
    if (bleDevice != null && bleDevice.gatt.connected) {
      bleDevice.gatt.disconnect();
    }
  }
  else {
    resetVariables();
    try {
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'GR_EPD_' },
          { name: 'Bootloader_OTA' },
        ],
        optionalServices: ['62750001-d828-918d-fb46-b6c11c675aec', OTA_SERVICE_UUID],
      });
    } catch (e) {
      console.error(e);
      if (e.message) addLog("requestDevice: " + e.message);
      addLog("请检查蓝牙是否已开启；升级中断时请选择 Bootloader_OTA 进行恢复。");
      addLog("建议使用以下浏览器：");
      addLog("• 电脑: Chrome/Edge");
      addLog("• Android: Chrome/Edge");
      addLog("• iOS: Bluefy 浏览器");
      return;
    }

    await bleDevice.addEventListener('gattserverdisconnected', disconnect);
    setTimeout(async function () { await connect(); }, 300);
  }
}

async function reConnect() {
  if (bleDevice == null) { addLog('请先连接设备'); return; }
  addLog("正在重连");
  if (bleDevice.gatt.connected) {
    const disconnected = new Promise(resolve => {
      bleDevice.addEventListener('gattserverdisconnected', resolve, { once: true });
      setTimeout(resolve, 1500);
    });
    bleDevice.gatt.disconnect();
    await disconnected;
  }
  resetVariables();
  setTimeout(async function () { await connect(); }, 100);
}

function handleNotify(value, idx) {
  const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (slotReadState && slotReadState.expected && receiveSlotChunk(data)) return;
  if (idx == 0) {
    addLog(`收到配置：${bytes2hex(data)}`);
    const epdpins = document.getElementById("epdpins");
    const epddriver = document.getElementById("epddriver");
    epdpins.value = bytes2hex(data.slice(0, 7));
    if (data.length > 10) epdpins.value += bytes2hex(data.slice(10, 11));
    const reportedDriver = bytes2hex(data.slice(7, 8));
    if (epddriver.querySelector(`option[value="${reportedDriver}"]`)) {
      epddriver.value = reportedDriver;
      addLog(`设备驱动配置: ${reportedDriver === '13' ? '2.13寸 UC8151D 横屏' : reportedDriver}`);
    } else {
      addLog(`设备返回未知驱动配置: ${reportedDriver}`);
    }
    updateDitcherOptions();
  } else {
    if (textDecoder == null) textDecoder = new TextDecoder();
    const msg = textDecoder.decode(data);
    const logMessage = msg.startsWith('activation=')
      ? (msg.startsWith('activation=1') ? '设备已激活' : '设备未激活')
      : msg;
    addLog(logMessage, '⇓');
    if (msg === 'slot_v2=1 slot_stream=1') {
      slotStreamSupport = true;
      void refreshSlots(0);
    } else if (msg.startsWith('slots=')) {
      const parsed = parseSlotsMessage(msg);
      if (parsed) {
        slotState = parsed;
        slotActionPending = false;
        document.getElementById('slotReadStatus').textContent = '槽位信息已更新';
        updateButtonStatus(); renderSlotGrid();
      }
    } else if (msg.startsWith('slot=ready ')) {
      const slot = Number(msg.substring(11));
      if (slotPrepareWait && slotPrepareWait.slot === slot) {
        clearTimeout(slotPrepareWait.timer);
        const resolve = slotPrepareWait.resolve;
        slotPrepareWait = null;
        resolve(true);
      }
    } else if (msg.startsWith('slot=saved ') || msg === 'slot=deleted' || msg === 'slot=cleared' ||
      msg === 'display=done' || msg.startsWith('slide=')) {
      slotActionPending = false;
      updateButtonStatus(); renderSlotGrid();
      void refreshSlots();
    } else if (msg.startsWith('slot=') && msg.includes('error')) {
      slotActionPending = false;
      if (slotPrepareWait) {
        clearTimeout(slotPrepareWait.timer);
        const resolve = slotPrepareWait.resolve;
        slotPrepareWait = null;
        resolve(false);
      }
      updateButtonStatus(); renderSlotGrid();
    } else if (msg.startsWith('img=')) {
      beginSlotRead(msg);
    } else if (msg.startsWith('chunk=')) {
      beginSlotChunk(msg);
    } else if (msg.startsWith('mtu=') && msg.length > 4) {
      const mtuSize = parseInt(msg.substring(4));
      document.getElementById('mtusize').value = mtuSize;
      addLog(`MTU 已更新为: ${mtuSize}`);
      if (msg.includes('rle=1')) {
        rleSupport = true;
        addLog('已开启 RLE 压缩传输支持');
      }
    } else if (msg.startsWith('led=')) {
      const match = /^led=([01]) board=(11|12) color=([1-7]) brightness=(\d{1,3})$/.exec(msg);
      if (match) {
        ledEnabled = match[1] === '1';
        const ledToggleButton = document.getElementById('ledToggleButton');
        if (ledToggleButton) {
          ledToggleButton.textContent = ledEnabled ? 'LED 关' : 'LED 开';
          ledToggleButton.classList.toggle('primary', !ledEnabled);
          ledToggleButton.classList.toggle('danger', ledEnabled);
          ledToggleButton.setAttribute('aria-pressed', String(ledEnabled));
        }
        document.getElementById('ledBoardRevision').value = match[2];
        document.getElementById('ledColor').value = match[3];
        document.getElementById('ledBrightness').value = match[4];
        updateLedBrightnessLabel();
      }
    } else if (msg.startsWith('status ')) {
      const match = /^status voltage=(\d+) battery=(\d{1,3}) temperature=(-?\d+)$/.exec(msg);
      if (match) {
        updateBatteryStatus(Number(match[1]), Number(match[2]), Number(match[3]));
        addLog(`电池电量: ${match[2]}%（${(Number(match[1]) / 1000).toFixed(2)}V）${Number(match[3]) === -1 ? '，温度不可用' : `，温度 ${match[3]}℃`}`);
      }
    } else if (msg === 'activation=already') {
      recordActivationState(true);
      activationSubmitPending = false;
      activationResetExpected = false;
      setActivationPanelVisible(false);
      document.getElementById('activationStatus').textContent = '该设备已激活';
      addLog('该设备已激活，未重复写入激活信息');
    } else if (msg === 'activation=ok') {
      recordActivationState(true);
      activationSubmitPending = false;
      activationResetExpected = true;
      setActivationPanelVisible(false);
      document.getElementById('activationStatus').textContent = '设备已激活，正在重启';
      addLog('设备已激活，固件即将重启');
    } else if (msg === 'activation=invalid') {
      activationSubmitPending = false;
      activationResetExpected = false;
      document.getElementById('activationStatus').textContent = '激活失败：证书无效或不属于本设备';
    } else if (msg.startsWith('activation=')) {
      const active = msg.startsWith('activation=1');
      recordActivationState(active);
      const autoSync = shouldSyncAfterActivation(msg, activationReconnectSyncPending);
      activationSubmitPending = false;
      activationResetExpected = false;
      document.getElementById('activationStatus').textContent = active ?
        '设备已激活' : msg.replace('activation=0 ', '设备未激活　');
      setActivationPanelVisible(!active);
      if (autoSync) {
        activationReconnectSyncPending = false;
        addLog('激活状态已确认，正在自动同步时间');
        void syncTime(1);
      }
    } else if (msg.startsWith('locked=')) {
      setActivationPanelVisible(true);
      document.getElementById('activationStatus').textContent = '设备未激活，当前功能已被固件拒绝';
    } else if (msg.startsWith('t=') && msg.length > 2) {
      const rawSeconds = parseInt(msg.substring(2));
      resolveTimeSample(rawSeconds);
      const t = rawSeconds;
      addLog(`远端时间: ${formatWallClockTime(t)}`);
      addLog(`本地时间: ${new Date().toLocaleString()}`);
    }
  }
}

async function connect() {
  if (bleDevice == null || (gattServer != null && gattServer.connected)) return;

  try {
    addLog("正在连接: " + bleDevice.name);
    gattServer = await bleDevice.gatt.connect();
    addLog('  找到 GATT Server');
  } catch (e) {
    console.error(e);
    if (e.message) addLog("connect: " + e.message);
    disconnect();
    return;
  }

  try {
    epdService = await gattServer.getPrimaryService('62750001-d828-918d-fb46-b6c11c675aec');
    addLog('  找到 EPD Service');
    epdCharacteristic = await epdService.getCharacteristic('62750002-d828-918d-fb46-b6c11c675aec');
    addLog('  找到 Characteristic');
  } catch (e) {
    epdService = null;
    epdCharacteristic = null;
    bootloaderMode = true;
    addLog('  未找到 EPD Service，已进入 Bootloader OTA 救援模式');
  }

  if (!bootloaderMode) {
    try {
      const versionCharacteristic = await epdService.getCharacteristic('62750003-d828-918d-fb46-b6c11c675aec');
      const versionData = await versionCharacteristic.readValue();
      appVersion = versionData.getUint8(0);
      addLog(`固件版本: 0x${appVersion.toString(16)}`);
    } catch (e) {
      console.error(e);
      appVersion = 0x15;
    }

    if (appVersion < 0x16) {
      const oldURL = "https://tsl0922.github.io/EPD-nRF5/v1.5";
      alert("!!!注意!!!\n当前固件版本过低，可能无法正常使用部分功能，建议升级到最新版本。");
      if (confirm('是否访问旧版本上位机？')) location.href = oldURL;
      setTimeout(() => {
        addLog(`如遇到问题，可访问旧版本上位机: ${oldURL}`);
      }, 500);
    }

    try {
      await epdCharacteristic.startNotifications();
      epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
        handleNotify(event.target.value, msgIndex++);
      });
    } catch (e) {
      console.error(e);
      if (e.message) addLog("startNotifications: " + e.message);
    }
  }

  try {
    otaService = await gattServer.getPrimaryService(OTA_SERVICE_UUID);
    otaTxCharacteristic = await otaService.getCharacteristic(OTA_TX_UUID);
    otaRxCharacteristic = await otaService.getCharacteristic(OTA_RX_UUID);
    otaControlCharacteristic = await otaService.getCharacteristic(OTA_CONTROL_UUID);
    await otaTxCharacteristic.startNotifications();
    otaTxCharacteristic.addEventListener('characteristicvaluechanged', handleOtaNotification);
    addLog('  Goodix OTA 服务已就绪');
    if (bootloaderMode) {
      setOtaStatus('Bootloader 救援模式已连接，可选择原项目 OTA 固件恢复', 'success');
      addLog('  Bootloader OTA 救援通道已就绪');
    } else {
      setOtaStatus('设备已连接，可选择 OTA 固件升级');
    }
  } catch (e) {
    console.error(e);
    otaService = null;
    otaTxCharacteristic = null;
    otaRxCharacteristic = null;
    otaControlCharacteristic = null;
    addLog('当前固件未提供 Goodix OTA 服务');
    setOtaStatus('设备不支持网页 OTA', 'error');
    if (bootloaderMode) {
      disconnect();
      return;
    }
  }

  if (!bootloaderMode) {
    await write(EpdCmd.INIT);
    await write(EpdCmd.GET_STATUS);
    await queryActivation();
    setTimeout(() => {
      if (gattServer && gattServer.connected && epdCharacteristic && !otaBusy) void write(EpdCmd.GET_STATUS);
    }, 1200);
  }

  document.getElementById("connectbutton").innerHTML = '断开';
  updateButtonStatus();
}

function readUint32LE(data, offset) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function writeUint32LE(data, offset, value) {
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(offset, value >>> 0, true);
}

function setOtaStatus(message, state = '') {
  const status = document.getElementById('otaStatus');
  status.textContent = message;
  status.className = `ota-status${state ? ` ${state}` : ''}`;
}

function setOtaProgress(value) {
  const progress = Math.max(0, Math.min(100, Math.round(value)));
  document.getElementById('otaProgress').value = progress;
  document.getElementById('otaProgressText').textContent = `${progress}%`;
}

function formatOtaDuration(milliseconds) {
  const seconds = Math.max(0, milliseconds) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function updateOtaMetrics(written = 0, complete = false) {
  const metrics = document.getElementById('otaMetrics');
  if (!metrics || !otaTransferStats) return;
  const now = performance.now();
  const transferElapsed = Math.max(1, now - otaTransferStats.transferStartedAt);
  const totalElapsed = Math.max(1, now - otaTransferStats.startedAt);
  const speed = written > 0 ? written / 1024 / (transferElapsed / 1000) : 0;

  if (complete) {
    metrics.textContent = `平均 ${speed.toFixed(1)} KiB/s · 传输 ${formatOtaDuration(transferElapsed)} · 总耗时 ${formatOtaDuration(totalElapsed)}`;
    return;
  }

  const remainingMs = speed > 0 ? ((otaTransferStats.totalBytes - written) / 1024 / speed) * 1000 : 0;
  const remaining = speed > 0 ? ` · 预计剩余 ${formatOtaDuration(remainingMs)}` : '';
  metrics.textContent = `${speed.toFixed(1)} KiB/s · ${(written / 1024).toFixed(1)} / ${(otaTransferStats.totalBytes / 1024).toFixed(1)} KiB · 已用 ${formatOtaDuration(totalElapsed)}${remaining}`;
}

function byteSum(data) {
  let sum = 0;
  for (const value of data) sum = (sum + value) >>> 0;
  return sum;
}

function containsAscii(data, marker) {
  const expected = new TextEncoder().encode(marker);
  outer: for (let i = 0; i <= data.length - expected.length; i++) {
    for (let j = 0; j < expected.length; j++) {
      if (data[i + j] !== expected[j]) continue outer;
    }
    return true;
  }
  return false;
}

function validateOtaPackage(bytes) {
  if (bytes.length <= OTA_TAIL_SIZE) throw new Error('文件过小，不是有效的 OTA 固件包');
  if (bytes.length > OTA_NVDS_ADDRESS - OTA_SAVE_ADDRESS) throw new Error('固件超过 OTA 暂存区容量');

  const infoOffset = bytes.length - OTA_TAIL_SIZE;
  const view = new DataView(bytes.buffer, bytes.byteOffset + infoOffset, OTA_IMAGE_INFO_SIZE);
  if (view.getUint16(0, true) !== 0x4744 || view.getUint16(2, true) !== 1) {
    throw new Error('缺少 Goodix OTA 尾信息，请勿选择完整烧录固件');
  }
  const binSize = view.getUint32(4, true);
  const expectedChecksum = view.getUint32(8, true);
  const loadAddress = view.getUint32(12, true);
  const runAddress = view.getUint32(16, true);
  if (binSize !== infoOffset) throw new Error('OTA 固件长度信息不匹配');
  if (loadAddress !== OTA_APPLICATION_ADDRESS || runAddress !== OTA_APPLICATION_ADDRESS) {
    throw new Error('OTA 固件目标地址不是 0x01020000');
  }
  if (byteSum(bytes.subarray(0, binSize)) !== expectedChecksum) throw new Error('OTA 固件校验和错误');
  for (const marker of OTA_ACTIVATION_MARKERS) {
    if (!containsAscii(bytes.subarray(0, binSize), marker)) {
      throw new Error('OTA 固件缺少激活保护标记，已拒绝旧版或非本项目固件');
    }
  }
  for (let i = bytes.length - 8; i < bytes.length; i++) {
    if (bytes[i] !== 0xFF) throw new Error('OTA 固件尾部格式错误');
  }

  return {
    bytes,
    transferBytes: bytes.slice(0, infoOffset + OTA_IMAGE_INFO_SIZE),
    imageInfo: bytes.slice(infoOffset, infoOffset + OTA_IMAGE_INFO_SIZE),
    checksum: byteSum(bytes.subarray(0, infoOffset + OTA_IMAGE_INFO_SIZE)),
  };
}

async function handleOtaFileChange() {
  const input = document.getElementById('otaFile');
  const info = document.getElementById('otaFileInfo');
  otaSelectedPackage = null;
  setOtaProgress(0);

  if (!input.files || input.files.length === 0) {
    info.textContent = '请选择本项目生成的 OTA 固件包';
    setOtaStatus('等待选择固件');
    updateButtonStatus();
    return;
  }

  const file = input.files[0];
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    otaSelectedPackage = validateOtaPackage(bytes);
    info.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KiB`;
    setOtaStatus('固件校验通过，等待开始升级', 'success');
  } catch (e) {
    info.textContent = file.name;
    setOtaStatus(e.message || '固件校验失败', 'error');
  }
  updateButtonStatus();
}

function makeDfuFrame(command, payload = new Uint8Array(0)) {
  const frame = new Uint8Array(payload.length + 8);
  const view = new DataView(frame.buffer);
  frame[0] = 0x44;
  frame[1] = 0x47;
  view.setUint16(2, command, true);
  view.setUint16(4, payload.length, true);
  frame.set(payload, 6);
  view.setUint16(frame.length - 2, byteSum(frame.subarray(2, frame.length - 2)) & 0xFFFF, true);
  return frame;
}

function handleOtaNotification(event) {
  const value = event.target.value;
  const incoming = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const combined = new Uint8Array(otaReceiveBuffer.length + incoming.length);
  combined.set(otaReceiveBuffer);
  combined.set(incoming, otaReceiveBuffer.length);
  otaReceiveBuffer = combined;

  while (otaReceiveBuffer.length >= 8) {
    let header = -1;
    for (let i = 0; i < otaReceiveBuffer.length - 1; i++) {
      if (otaReceiveBuffer[i] === 0x44 && otaReceiveBuffer[i + 1] === 0x47) {
        header = i;
        break;
      }
    }
    if (header < 0) {
      otaReceiveBuffer = otaReceiveBuffer.slice(-1);
      return;
    }
    if (header > 0) otaReceiveBuffer = otaReceiveBuffer.slice(header);
    if (otaReceiveBuffer.length < 8) return;

    const view = new DataView(otaReceiveBuffer.buffer, otaReceiveBuffer.byteOffset, otaReceiveBuffer.byteLength);
    const command = view.getUint16(2, true);
    const payloadLength = view.getUint16(4, true);
    if (payloadLength > OTA_MAX_RESPONSE_PAYLOAD) {
      addLog(`OTA 响应长度异常: ${payloadLength}，已重新同步`);
      otaReceiveBuffer = otaReceiveBuffer.slice(2);
      continue;
    }
    const frameLength = payloadLength + 8;
    if (otaReceiveBuffer.length < frameLength) return;

    const frame = otaReceiveBuffer.slice(0, frameLength);
    otaReceiveBuffer = otaReceiveBuffer.slice(frameLength);
    const receivedChecksum = new DataView(frame.buffer).getUint16(frame.length - 2, true);
    const calculatedChecksum = byteSum(frame.subarray(2, frame.length - 2)) & 0xFFFF;
    if (receivedChecksum !== calculatedChecksum) {
      addLog(`OTA 响应校验失败: 0x${command.toString(16)}`);
      continue;
    }

    const data = frame.slice(6, frame.length - 2);
    if (otaPendingResponse && otaPendingResponse.command === command &&
        (!otaPendingResponse.accept || otaPendingResponse.accept(data))) {
      const pending = otaPendingResponse;
      otaPendingResponse = null;
      clearTimeout(pending.timer);
      pending.resolve(data);
    } else if (otaPendingSignal && otaPendingSignal.command === command && otaPendingSignal.accept(data)) {
      const signal = otaPendingSignal;
      otaPendingSignal = null;
      clearTimeout(signal.timer);
      signal.resolve(data);
    } else if (command === DfuCmd.PROGRAM_START) {
      // Some GR5513 builds repeat the erase-complete notification; it is idempotent.
    } else {
      addLog(`OTA 收到未等待的响应: 0x${command.toString(16)}`);
    }
  }
}

function waitForDfuSignal(command, accept, timeoutMs = 30000) {
  if (otaPendingSignal) throw new Error('上一条 OTA 状态通知尚未完成');
  let resolveSignal;
  let rejectSignal;
  const response = new Promise((resolve, reject) => {
    resolveSignal = resolve;
    rejectSignal = reject;
  });
  const timer = setTimeout(() => {
    if (otaPendingSignal && otaPendingSignal.command === command) otaPendingSignal = null;
    rejectSignal(new Error(`OTA 状态 0x${command.toString(16)} 等待超时`));
  }, timeoutMs);
  otaPendingSignal = { command, accept, resolve: resolveSignal, reject: rejectSignal, timer };
  return response;
}

async function sendDfuRequest(command, payload = new Uint8Array(0), timeoutMs = 10000, accept = null) {
  if (!otaRxCharacteristic) throw new Error('OTA 写入通道不可用');
  if (otaPendingResponse) throw new Error('上一条 OTA 命令尚未完成');

  let resolveResponse;
  let rejectResponse;
  const response = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const timer = setTimeout(() => {
    if (otaPendingResponse && otaPendingResponse.command === command) otaPendingResponse = null;
    rejectResponse(new Error(`OTA 命令 0x${command.toString(16)} 响应超时`));
  }, timeoutMs);
  otaPendingResponse = { command, resolve: resolveResponse, reject: rejectResponse, timer, accept };

  try {
    await otaRxCharacteristic.writeValueWithoutResponse(makeDfuFrame(command, payload));
  } catch (e) {
    clearTimeout(timer);
    otaPendingResponse = null;
    rejectResponse(e);
  }
  return response;
}

async function expectDfuSuccess(command, payload = new Uint8Array(0), timeoutMs = 10000, accept = null) {
  const response = await sendDfuRequest(command, payload, timeoutMs, accept);
  if (response.length === 0 || response[0] !== 1) {
    throw new Error(`OTA 命令 0x${command.toString(16)} 执行失败`);
  }
  return response;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function sendReliableOtaPayload(firmware, targetAddress) {
  try {
    for (let offset = 0; offset < firmware.length; offset += OTA_CHUNK_SIZE) {
      const chunk = firmware.subarray(offset, Math.min(offset + OTA_CHUNK_SIZE, firmware.length));
      const payload = new Uint8Array(7 + chunk.length);
      payload[0] = 1;
      writeUint32LE(payload, 1, targetAddress + offset);
      new DataView(payload.buffer).setUint16(5, chunk.length, true);
      await expectDfuSuccess(DfuCmd.PROGRAM_FLASH, payload, 15000);
      const written = offset + chunk.length;
      const progress = 7 + (written / firmware.length) * 90;
      setOtaProgress(progress);
      updateOtaMetrics(written);
      setOtaStatus(`正在写入固件 ${(written / 1024).toFixed(1)} / ${(firmware.length / 1024).toFixed(1)} KiB`);
    }
  } catch (error) {
    throw error;
  }
}

async function startOtaUpgrade() {
  if (!otaSelectedPackage || !otaRxCharacteristic || !otaControlCharacteristic) return;
  if (!bootloaderMode && lastBatteryStatus && lastBatteryStatus.voltage < 2700) {
    setOtaStatus('电压低于 2.70V，已禁止 OTA 升级', 'error');
    addLog(`OTA 已取消：当前电压 ${(lastBatteryStatus.voltage / 1000).toFixed(2)}V，低于最低刷新电压 2.70V`);
    return;
  }
  if (!bootloaderMode) {
    setOtaStatus('正在读取升级前激活状态');
    otaExpectedActivationState = await waitForActivationState();
    if (otaExpectedActivationState === null) {
      setOtaStatus('无法确认设备激活状态，已取消 OTA', 'error');
      addLog('OTA 已取消：升级前未收到激活状态');
      return;
    }
  } else {
    // A generic Bootloader_OTA advertisement cannot be tied safely to the
    // previously selected application device when several units are nearby.
    otaExpectedActivationState = null;
  }
  const activationText = bootloaderMode ? '当前为 Bootloader 救援模式' :
    `当前设备${otaExpectedActivationState ? '已激活' : '未激活'}，升级后将自动复核`;
  if (!confirm(`${activationText}。\n升级过程中请保持设备供电和蓝牙连接，确认开始 OTA 升级？`)) return;

  otaBusy = true;
  otaFinalizing = false;
  otaCompletedAwaitingRestart = false;
  otaVerificationPending = false;
  otaTransferStats = {
    startedAt: performance.now(),
    transferStartedAt: performance.now(),
    totalBytes: otaSelectedPackage.bytes.length,
  };
  updateButtonStatus(true);
  setOtaProgress(1);
  updateOtaMetrics(0);
  setOtaStatus('正在进入 OTA 模式');
  addLog('开始 Goodix BLE OTA 升级');

  try {
    await otaControlCharacteristic.writeValueWithoutResponse(Uint8Array.of(0x44, 0x4F, 0x4F, 0x47));
    await delay(100);
    await expectDfuSuccess(DfuCmd.GET_INFO);
    setOtaProgress(3);

    // GR5513 application-side dfu_port does not register SYSTEM_INFO (0x27).
    // GET_INFO is followed directly by DFU_FW_INFO_GET in this target flow.
    const firmwareInfo = await expectDfuSuccess(DfuCmd.DFU_FW_INFO_GET);
    if (firmwareInfo.length < 5) throw new Error('设备返回的 OTA 暂存地址无效');
    const reportedSaveAddress = readUint32LE(firmwareInfo, 1);
    const targetAddress = bootloaderMode ? OTA_APPLICATION_ADDRESS : reportedSaveAddress;
    if (!bootloaderMode && targetAddress !== OTA_SAVE_ADDRESS) {
      throw new Error(`设备 OTA 暂存地址不匹配: 0x${targetAddress.toString(16).padStart(8, '0')}`);
    }

    const dfuMode = bootloaderMode ? 2 : 1;
    await otaRxCharacteristic.writeValueWithoutResponse(makeDfuFrame(DfuCmd.DFU_MODE_SET, Uint8Array.of(dfuMode)));
    await delay(150);

    const startPayload = new Uint8Array(1 + OTA_IMAGE_INFO_SIZE);
    // Use the acknowledged DFU path for compatibility with the stable
    // bootloader implementation. Each flash block is confirmed before the
    // next block is sent.
    startPayload[0] = 0;
    startPayload.set(otaSelectedPackage.imageInfo, 1);
    // In copy mode Goodix expects load_addr to point at the staging bank while
    // run_addr remains the final application address. Bootloader rescue writes
    // directly to the original application address in non-copy mode.
    writeUint32LE(startPayload, 1 + 12, targetAddress);
    setOtaStatus(bootloaderMode ? '正在恢复应用固件' : '正在擦除 OTA 暂存区');
    await expectDfuSuccess(DfuCmd.PROGRAM_START, startPayload, 60000);
    addLog('OTA 擦除完成，开始逐块确认传输');
    setOtaProgress(7);
    otaTransferStats.transferStartedAt = performance.now();
    updateOtaMetrics(0);

    const firmware = otaSelectedPackage.bytes;
    await sendReliableOtaPayload(firmware, targetAddress);

    const endPayload = new Uint8Array(5);
    endPayload[0] = 1;
    writeUint32LE(endPayload, 1, otaSelectedPackage.checksum);
    setOtaStatus('正在校验固件并重启设备');
    otaFinalizing = true;
    const endResponse = await expectDfuSuccess(DfuCmd.PROGRAM_END, endPayload, 30000);
    otaFinalizing = false;
    if (endResponse.length >= 5 && readUint32LE(endResponse, 1) !== otaSelectedPackage.checksum) {
      throw new Error('设备返回的整包校验和不匹配');
    }

    otaCompletedAwaitingRestart = true;
    setOtaProgress(100);
    updateOtaMetrics(firmware.length, true);
    setOtaStatus('OTA 升级完成，设备正在重启', 'success');
    addLog(`OTA 升级完成，${document.getElementById('otaMetrics')?.textContent || '设备正在重启'}`);
  } catch (e) {
    console.error(e);
    if (e.otaRestartExpected) {
      otaCompletedAwaitingRestart = true;
      setOtaProgress(100);
      updateOtaMetrics(otaSelectedPackage.bytes.length, true);
      setOtaStatus('OTA 传输已完成，设备正在重启；请重连确认版本', 'success');
      addLog('PROGRAM_END 已提交，断开属于设备重启阶段');
    } else {
      if (otaPendingSignal) {
        clearTimeout(otaPendingSignal.timer);
        otaPendingSignal = null;
      }
      otaFinalizing = false;
      setOtaStatus(`OTA 升级失败: ${e.message || e}`, 'error');
      addLog(`OTA 升级失败: ${e.message || e}`);
      if (!gattServer || !gattServer.connected) {
        addLog('请点击连接并扫描 Bootloader_OTA，已选择的固件会保留，可直接继续恢复');
      }
    }
  } finally {
    otaBusy = false;
    updateButtonStatus();
  }
}

function setStatus(statusText) {
  document.getElementById("status").innerHTML = statusText;
}

function addLog(logTXT, action = '') {
  const log = document.getElementById("log");
  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + ":" +
    String(now.getMinutes()).padStart(2, '0') + ":" +
    String(now.getSeconds()).padStart(2, '0') + " ";

  const logEntry = document.createElement('div');
  const timeSpan = document.createElement('span');
  logEntry.className = 'log-line';
  timeSpan.className = 'time';
  timeSpan.textContent = time;
  logEntry.appendChild(timeSpan);

  if (action !== '') {
    const actionSpan = document.createElement('span');
    actionSpan.className = 'action';
    actionSpan.innerHTML = action;
    logEntry.appendChild(actionSpan);
  }
  logEntry.appendChild(document.createTextNode(logTXT));

  log.appendChild(logEntry);
  log.scrollTop = log.scrollHeight;

  while (log.childNodes.length > 120) {
    log.removeChild(log.firstChild);
  }
}

function clearLog() {
  document.getElementById("log").innerHTML = '';
}

function fillCanvas(style) {
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function setCanvasTitle(title) {
  const canvasTitle = document.querySelector('.canvas-title');
  if (canvasTitle) {
    canvasTitle.innerText = title;
    canvasTitle.style.display = title && title !== '' ? 'block' : 'none';
  }
}

function updateImage() {
  const imageFile = document.getElementById('imageFile');
  if (imageFile.files.length == 0) {
    if (cropManager && cropManager.clearImage) cropManager.clearImage();
    fillCanvas('white');
    return;
  }
  const file = imageFile.files[0];
  cropManager.loadFile(file).then(() => {
    paintManager.setActiveTool(null, '');
  }).catch((error) => {
    addLog(`图片加载失败: ${error.message || error}`);
    fillCanvas('white');
  });
}

function updateCanvasSize() {
  const selectedSizeName = document.getElementById('canvasSize').value;
  const selectedSize = canvasSizes.find(size => size.name === selectedSizeName);

  canvas.width = selectedSize.width;
  canvas.height = selectedSize.height;

  updateImage();
}

function updateDitcherOptions() {
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];
  const colorMode = selectedOption.getAttribute('data-color');
  const canvasSize = selectedOption.getAttribute('data-size');

  if (colorMode) document.getElementById('ditherMode').value = colorMode;
  if (canvasSize) document.getElementById('canvasSize').value = canvasSize;

  updateCanvasSize(); // always update image
}

function rotateCanvas() {
  const currentWidth = canvas.width;
  const currentHeight = canvas.height;

  // Capture current canvas content
  const imageData = ctx.getImageData(0, 0, currentWidth, currentHeight);

  // Swap canvas dimensions
  canvas.width = currentHeight;
  canvas.height = currentWidth;

  // Create temporary canvas for rotation
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = currentWidth;
  tempCanvas.height = currentHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);

  // Draw rotated image on the resized canvas
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(90 * Math.PI / 180);
  ctx.drawImage(tempCanvas, -currentWidth / 2, -currentHeight / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

  paintManager.clearHistory(); // Clear history as canvas size changed
  paintManager.clearElements(); // Clear stored text positions and line segments
  paintManager.saveToHistory(); // Save rotated canvas to history
}

function clearCanvas() {
  if (confirm('清除画布内容?')) {
    fillCanvas('white');
    paintManager.clearElements(); // Clear stored text positions and line segments
    if (cropManager && cropManager.clearImage) cropManager.clearImage();
    paintManager.saveToHistory(); // Save cleared canvas to history
    return true;
  }
  return false;
}

function convertDithering(saveHistory = true) {
  paintManager.redrawTextElements();
  paintManager.redrawLineSegments();

  const contrast = parseFloat(document.getElementById('ditherContrast').value);
  const currentImageData = ditherSourceImageData &&
    ditherSourceImageData.width === canvas.width &&
    ditherSourceImageData.height === canvas.height
    ? ditherSourceImageData
    : ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImageData.data),
    currentImageData.width,
    currentImageData.height
  );

  adjustContrast(imageData, contrast);
  const brightness = parseFloat(document.getElementById('ditherBrightness')?.value || '1');
  const saturation = parseFloat(document.getElementById('ditherSaturation')?.value || '1');
  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    imageData.data[i] = Math.max(0, Math.min(255, gray + (r - gray) * saturation) * brightness);
    imageData.data[i + 1] = Math.max(0, Math.min(255, gray + (g - gray) * saturation) * brightness);
    imageData.data[i + 2] = Math.max(0, Math.min(255, gray + (b - gray) * saturation) * brightness);
  }

  const alg = document.getElementById('ditherAlg').value;
  const strength = parseFloat(document.getElementById('ditherStrength').value);
  const mode = document.getElementById('ditherMode').value;
  const processedData = processImageData(ditherImage(imageData, alg, strength, mode), mode);
  const finalImageData = decodeProcessedData(processedData, canvas.width, canvas.height, mode);
  ctx.putImageData(finalImageData, 0, 0);

  if (saveHistory) paintManager.saveToHistory(); // Save only committed changes
}

function applyDither() {
  if (cropManager && cropManager.commitPendingTransform) cropManager.commitPendingTransform(false);
  convertDithering();
}

function scheduleDitherPreview() {
  if (ditherPreviewFrame) return;
  ditherPreviewFrame = requestAnimationFrame(() => {
    ditherPreviewFrame = 0;
    applyDither();
  });
}

function resetImageAdjustments() {
  const defaults = { ditherStrength: 1, ditherContrast: 1.2, ditherBrightness: 1, ditherSaturation: 1 };
  for (const [id, value] of Object.entries(defaults)) {
    const control = document.getElementById(id);
    if (!control) continue;
    control.value = value;
    const output = document.getElementById(`${id}Value`);
    if (output) output.textContent = Number(value).toFixed(1);
  }
  applyDither();
}

function initEventHandlers() {
  const dropTarget = document.querySelector('.canvas-container');
  const imageFile = document.getElementById('imageFile');
  if (dropTarget && imageFile) {
    ['dragenter', 'dragover'].forEach(type => dropTarget.addEventListener(type, e => { e.preventDefault(); dropTarget.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(type => dropTarget.addEventListener(type, e => { e.preventDefault(); dropTarget.classList.remove('drag-over'); }));
    dropTarget.addEventListener('drop', e => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      const transfer = new DataTransfer(); transfer.items.add(file); imageFile.files = transfer.files; updateImage();
    });
  }
  document.getElementById("ditherStrength").addEventListener("input", (e) => {
    document.getElementById("ditherStrengthValue").innerText = parseFloat(e.target.value).toFixed(1);
    scheduleDitherPreview();
  });
  document.getElementById("ditherContrast").addEventListener("input", (e) => {
    document.getElementById("ditherContrastValue").innerText = parseFloat(e.target.value).toFixed(1);
    scheduleDitherPreview();
  });
  for (const id of ['ditherBrightness', 'ditherSaturation']) {
    document.getElementById(id).addEventListener('input', (e) => {
      document.getElementById(`${id}Value`).innerText = parseFloat(e.target.value).toFixed(1);
      scheduleDitherPreview();
    });
  }
}

function checkDebugMode() {
  const link = document.getElementById('debug-toggle');
  const urlParams = new URLSearchParams(window.location.search);
  // The full editor is the default workspace; ?debug=false keeps a compact view.
  const debugMode = urlParams.get('debug') !== 'false';

  if (debugMode) {
    document.body.classList.add('editor-mode');
    document.body.classList.remove('dark-mode');
    link.innerHTML = '正常模式';
    link.setAttribute('href', window.location.pathname + '?debug=false');
    link.onclick = null;
    addLog("注意：开发模式功能已开启！不懂请不要随意修改，否则后果自负！");
  } else {
    document.body.classList.remove('editor-mode');
    document.body.classList.remove('dark-mode');
    link.innerHTML = '开发模式';
    link.setAttribute('href', window.location.pathname + '?debug=true');
    link.onclick = (event) => {
      if (confirm('开发模式可修改屏幕驱动、引脚和底层传输参数。\n不熟悉这些设置可能导致设备无法正常工作，确认进入开发模式吗？')) return;
      event.preventDefault();
    };
  }
}

const PAGE_BACKGROUND_STORAGE_KEY = 'epdCustomPageBackground';
const PAGE_BACKGROUND_SETTINGS_STORAGE_KEY = 'epdCustomPageBackgroundSettings';
const UI_OPACITY_STORAGE_KEY = 'epdUiOpacity';
const GLASS_CLARITY_STORAGE_KEY = 'epdGlassClarity';
const PAGE_BACKGROUND_DB_NAME = 'epdPageBackgroundV1';
const PAGE_BACKGROUND_DB_STORE = 'settings';
let currentPageBackgroundData = '';
const DEFAULT_PAGE_BACKGROUND_SETTINGS = { fit:'contain', zoom:1, offsetX:0, offsetY:0, rotate:0, flipX:false, flipY:false, brightness:1, contrast:1, saturation:1, mask:0.22 };

function openPageBackgroundDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = window.indexedDB.open(PAGE_BACKGROUND_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(PAGE_BACKGROUND_DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writePageBackgroundFallback(data, settings = DEFAULT_PAGE_BACKGROUND_SETTINGS) {
  const db = await openPageBackgroundDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(PAGE_BACKGROUND_DB_STORE, 'readwrite');
    transaction.objectStore(PAGE_BACKGROUND_DB_STORE).put({ data, settings }, 'current');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function readPageBackgroundFallback() {
  const db = await openPageBackgroundDb();
  const value = await new Promise((resolve, reject) => {
    const request = db.transaction(PAGE_BACKGROUND_DB_STORE, 'readonly').objectStore(PAGE_BACKGROUND_DB_STORE).get('current');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

async function clearPageBackgroundFallback() {
  const db = await openPageBackgroundDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(PAGE_BACKGROUND_DB_STORE, 'readwrite');
    transaction.objectStore(PAGE_BACKGROUND_DB_STORE).delete('current');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function updateRangeFill(range) { if (!range) return; range.style.setProperty('--range-progress', `${((Number(range.value) - Number(range.min || 0)) / (Number(range.max || 1) - Number(range.min || 0))) * 100}%`); }
function clampValue(value, min, max, fallback) { const n = parseFloat(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function applyUiOpacity(value) { const n = clampValue(value, 0, 1, 0.72); document.documentElement.style.setProperty('--ui-opacity', n); document.documentElement.style.setProperty('--ui-footer-opacity', Math.max(0, n - .1)); const r=document.getElementById('uiOpacityRange'), l=document.getElementById('uiOpacityValue'); if(r){r.value=n;updateRangeFill(r);} if(l)l.textContent=`${Math.round(n*100)}%`; }
function applyGlassClarity(value) { const n=clampValue(value,0,1,0); document.documentElement.style.setProperty('--glass-blur-size', `${((1-n)*24).toFixed(1)}px`); document.documentElement.style.setProperty('--page-bg-glass-blur-size', `${((1-n)*13.2).toFixed(1)}px`); const r=document.getElementById('glassClarityRange'),l=document.getElementById('glassClarityValue'); if(r){r.value=n;updateRangeFill(r);} if(l)l.textContent=`${Math.round(n*100)}%`; }
function normalizePageBackgroundSettings(source) { const s=source&&typeof source==='object'?source:{}; return { fit:['cover','contain','100% 100%'].includes(s.fit)?s.fit:'contain', zoom:clampValue(s.zoom,.5,3,1), offsetX:clampValue(s.offsetX,-40,40,0), offsetY:clampValue(s.offsetY,-40,40,0), rotate:clampValue(s.rotate,-180,180,0), flipX:s.flipX===true, flipY:s.flipY===true, brightness:clampValue(s.brightness,.4,1.6,1), contrast:clampValue(s.contrast,.5,1.8,1), saturation:clampValue(s.saturation,0,2,1), mask:clampValue(s.mask,0,.7,.22) }; }
function syncBackgroundControls(s) { const map=[['bgZoomRange','bgZoomValue',v=>`${Math.round(v*100)}%`],['bgOffsetXRange','bgOffsetXValue',v=>`${Math.round(v)}%`],['bgOffsetYRange','bgOffsetYValue',v=>`${Math.round(v)}%`],['bgRotateRange','bgRotateValue',v=>`${Math.round(v)}°`],['bgBrightnessRange','bgBrightnessValue',v=>`${Math.round(v*100)}%`],['bgContrastRange','bgContrastValue',v=>`${Math.round(v*100)}%`],['bgSaturationRange','bgSaturationValue',v=>`${Math.round(v*100)}%`],['bgMaskRange','bgMaskValue',v=>`${Math.round(v*100)}%`]]; map.forEach(([id,lid,f])=>{const r=document.getElementById(id),l=document.getElementById(lid);if(r){r.value=s[id.replace('bg','').replace('Range','').replace(/^./,c=>c.toLowerCase())] ?? r.value;updateRangeFill(r);}if(l&&r)l.textContent=f(Number(r.value));}); document.querySelectorAll('[data-bg-fit]').forEach(b=>b.classList.toggle('active',b.dataset.bgFit===s.fit)); document.querySelectorAll('[data-bg-toggle]').forEach(b=>b.classList.toggle('active',s[b.dataset.bgToggle]===true)); }
function readBackgroundControls(){ const active=document.querySelector('[data-bg-fit].active'); return normalizePageBackgroundSettings({fit:active?.dataset.bgFit,flipX:document.querySelector('[data-bg-toggle="flipX"]')?.classList.contains('active'),flipY:document.querySelector('[data-bg-toggle="flipY"]')?.classList.contains('active'),zoom:document.getElementById('bgZoomRange')?.value,offsetX:document.getElementById('bgOffsetXRange')?.value,offsetY:document.getElementById('bgOffsetYRange')?.value,rotate:document.getElementById('bgRotateRange')?.value,brightness:document.getElementById('bgBrightnessRange')?.value,contrast:document.getElementById('bgContrastRange')?.value,saturation:document.getElementById('bgSaturationRange')?.value,mask:document.getElementById('bgMaskRange')?.value}); }
function applyPageBackgroundSettings(settings){ const s=normalizePageBackgroundSettings(settings); document.documentElement.style.setProperty('--page-bg-fit',s.fit); document.documentElement.style.setProperty('--page-bg-transform',`translate(${s.offsetX}%,${s.offsetY}%) scale(${s.flipX?-s.zoom:s.zoom},${s.flipY?-s.zoom:s.zoom}) rotate(${s.rotate}deg)`); document.documentElement.style.setProperty('--page-bg-filter',`brightness(${s.brightness}) contrast(${s.contrast}) saturate(${s.saturation})`); document.documentElement.style.setProperty('--page-bg-overlay-opacity',s.mask); syncBackgroundControls(s); return s; }
function savePageBackgroundSettings(s){const n=applyPageBackgroundSettings(s);try{localStorage.setItem(PAGE_BACKGROUND_SETTINGS_STORAGE_KEY,JSON.stringify(n));}catch(error){}if(currentPageBackgroundData)void writePageBackgroundFallback(currentPageBackgroundData,n).catch(()=>{});return n;}
function applyPageBackground(data){currentPageBackgroundData=data||'';if(!data){document.body.classList.remove('custom-background');document.documentElement.style.setProperty('--page-bg-image','none');return;}document.body.classList.add('custom-background');document.documentElement.style.setProperty('--page-bg-image',`url("${data}")`);}
function resizeBackgroundImage(image){const scale=Math.min(1,1920/Math.max(image.width,image.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*scale));c.height=Math.max(1,Math.round(image.height*scale));c.getContext('2d').drawImage(image,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.82);}
function setPageBackgroundFromFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(url);
    const data = resizeBackgroundImage(image);
    applyPageBackgroundSettings(DEFAULT_PAGE_BACKGROUND_SETTINGS);
    applyPageBackground(data);
    try {
      localStorage.setItem(PAGE_BACKGROUND_STORAGE_KEY, data);
      localStorage.setItem(PAGE_BACKGROUND_SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_PAGE_BACKGROUND_SETTINGS));
    } catch (error) {
      addLog('浏览器常规存储不可用，已改用兼容存储保存网页背景');
    }
    void writePageBackgroundFallback(data, DEFAULT_PAGE_BACKGROUND_SETTINGS).catch(() => {
      addLog('网页背景已显示，但当前浏览器不允许持久保存');
    });
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    addLog('网页背景读取失败，请重新选择 PNG、JPG、BMP 或 WebP 图片');
  };
  image.src = url;
}
function toggleBackgroundControls(){const p=document.getElementById('backgroundControls'),b=document.getElementById('toggleBackgroundControls');if(!p||!b)return;const open=p.hidden;p.hidden=!open;b.setAttribute('aria-expanded',String(open));b.classList.toggle('active',open);}
function initPageBackground(){const file=document.getElementById('pageBackgroundFile');if(!file)return;let savedSettings={...DEFAULT_PAGE_BACKGROUND_SETTINGS},savedData='';try{savedSettings=JSON.parse(localStorage.getItem(PAGE_BACKGROUND_SETTINGS_STORAGE_KEY)||'null')||savedSettings;applyUiOpacity(localStorage.getItem(UI_OPACITY_STORAGE_KEY)||.72);applyGlassClarity(localStorage.getItem(GLASS_CLARITY_STORAGE_KEY)||0);savedData=localStorage.getItem(PAGE_BACKGROUND_STORAGE_KEY)||'';applyPageBackground(savedData);}catch(e){applyUiOpacity(.72);applyGlassClarity(0);}applyPageBackgroundSettings(savedSettings);if(!savedData)void readPageBackgroundFallback().then(record=>{if(!record?.data)return;applyPageBackgroundSettings(record.settings||DEFAULT_PAGE_BACKGROUND_SETTINGS);applyPageBackground(record.data);}).catch(()=>{});file.addEventListener('change',()=>setPageBackgroundFromFile(file.files?.[0]));document.getElementById('toggleBackgroundControls')?.addEventListener('click',toggleBackgroundControls);document.getElementById('openBackgroundSettings')?.addEventListener('click',()=>document.getElementById('backgroundSettingsModal').hidden=false);document.getElementById('closeBackgroundSettings')?.addEventListener('click',()=>document.getElementById('backgroundSettingsModal').hidden=true);document.getElementById('doneBackgroundSettings')?.addEventListener('click',()=>document.getElementById('backgroundSettingsModal').hidden=true);document.getElementById('clearPageBackground')?.addEventListener('click',()=>{try{localStorage.removeItem(PAGE_BACKGROUND_STORAGE_KEY);}catch(e){}void clearPageBackgroundFallback().catch(()=>{});applyPageBackground('');file.value='';});document.getElementById('resetBackgroundDefaults')?.addEventListener('click',()=>{try{[PAGE_BACKGROUND_STORAGE_KEY,PAGE_BACKGROUND_SETTINGS_STORAGE_KEY,UI_OPACITY_STORAGE_KEY,GLASS_CLARITY_STORAGE_KEY].forEach(k=>localStorage.removeItem(k));}catch(e){}void clearPageBackgroundFallback().catch(()=>{});applyPageBackground('');applyPageBackgroundSettings(DEFAULT_PAGE_BACKGROUND_SETTINGS);applyUiOpacity(.72);applyGlassClarity(0);});document.getElementById('uiOpacityRange')?.addEventListener('input',e=>{applyUiOpacity(e.target.value);try{localStorage.setItem(UI_OPACITY_STORAGE_KEY,e.target.value);}catch(error){}});document.getElementById('glassClarityRange')?.addEventListener('input',e=>{applyGlassClarity(e.target.value);try{localStorage.setItem(GLASS_CLARITY_STORAGE_KEY,e.target.value);}catch(error){}});document.querySelectorAll('[data-bg-fit]').forEach(b=>b.addEventListener('click',()=>savePageBackgroundSettings({...readBackgroundControls(),fit:b.dataset.bgFit})));document.querySelectorAll('[data-bg-toggle]').forEach(b=>b.addEventListener('click',()=>{b.classList.toggle('active');savePageBackgroundSettings(readBackgroundControls());}));['zoom','offsetX','offsetY','rotate','brightness','contrast','saturation','mask'].forEach(key=>{const id='bg'+key.charAt(0).toUpperCase()+key.slice(1)+'Range';document.getElementById(id)?.addEventListener('input',()=>savePageBackgroundSettings(readBackgroundControls()));});}

const LAYOUT_TEMPLATES_KEY = 'epdLayoutTemplatesV1';
let layoutDragState = null;
let layoutSuppressClick = false;

function layoutEditableElements() {
  return [...document.querySelectorAll('.main [id], .app-top-nav [id]')]
    .filter((el) => !el.closest('#layoutEditorPanel') && el.id !== 'layoutEditorButton' && el.id !== 'canvas');
}

function readLayoutOffsets() {
  const layout = {};
  layoutEditableElements().forEach((el) => {
    const x = Number(el.dataset.layoutX || 0);
    const y = Number(el.dataset.layoutY || 0);
    if (x || y) layout[el.id] = { x, y };
  });
  return layout;
}

function applyLayoutOffsets(layout = {}) {
  layoutEditableElements().forEach((el) => {
    const value = layout[el.id];
    const x = Number(value?.x || 0);
    const y = Number(value?.y || 0);
    el.dataset.layoutX = String(x);
    el.dataset.layoutY = String(y);
    el.style.translate = `${x}px ${y}px`;
  });
}

function loadLayoutTemplates() {
  try { return JSON.parse(localStorage.getItem(LAYOUT_TEMPLATES_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function refreshLayoutTemplateSelect() {
  const select = document.getElementById('layoutTemplateSelect');
  if (!select) return;
  const templates = loadLayoutTemplates();
  select.innerHTML = '<option value="">选择模板</option>';
  Object.keys(templates).sort().forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
}

function setLayoutEditing(enabled) {
  const panel = document.getElementById('layoutEditorPanel');
  const button = document.getElementById('layoutEditorButton');
  document.body.classList.toggle('layout-editing', enabled);
  if (panel) panel.hidden = !enabled;
  if (button) {
    button.classList.toggle('active', enabled);
    button.textContent = enabled ? '退出布局编辑' : '编辑布局';
    button.setAttribute('aria-pressed', String(enabled));
  }
  if (enabled) refreshLayoutTemplateSelect();
  if (!enabled) hideLayoutGuides();
}

function ensureLayoutGuides() {
  if (document.getElementById('layoutGuideX')) return;
  const vertical = document.createElement('div');
  const horizontal = document.createElement('div');
  vertical.id = 'layoutGuideX'; horizontal.id = 'layoutGuideY';
  vertical.className = 'layout-guide layout-guide-x'; horizontal.className = 'layout-guide layout-guide-y';
  document.body.append(vertical, horizontal);
}
function showLayoutGuides(x, y) {
  ensureLayoutGuides();
  const vertical = document.getElementById('layoutGuideX');
  const horizontal = document.getElementById('layoutGuideY');
  vertical.style.left = `${Math.round(x)}px`; vertical.hidden = x == null;
  horizontal.style.top = `${Math.round(y)}px`; horizontal.hidden = y == null;
}
function hideLayoutGuides() {
  document.getElementById('layoutGuideX')?.setAttribute('hidden', '');
  document.getElementById('layoutGuideY')?.setAttribute('hidden', '');
}
function snapLayoutPosition(state, x, y) {
  const threshold = 7;
  const targetRect = state.rect;
  const others = layoutEditableElements().filter((el) => el !== state.target).map((el) => el.getBoundingClientRect());
  const xCandidates = [Math.round(x / 4) * 4];
  const yCandidates = [Math.round(y / 4) * 4];
  let guideX = null, guideY = null;
  others.forEach((rect) => {
    const targetLeft = state.baseX + (rect.left - targetRect.left);
    const targetCenter = state.baseX + (rect.left + rect.width / 2 - (targetRect.left + targetRect.width / 2));
    const targetRight = state.baseX + (rect.right - targetRect.right);
    [targetLeft, targetCenter, targetRight].forEach((candidate) => xCandidates.push(candidate));
    const top = state.baseY + (rect.top - targetRect.top);
    const middle = state.baseY + (rect.top + rect.height / 2 - (targetRect.top + targetRect.height / 2));
    const bottom = state.baseY + (rect.bottom - targetRect.bottom);
    [top, middle, bottom].forEach((candidate) => yCandidates.push(candidate));
  });
  const pick = (value, candidates) => {
    let best = value; let distance = threshold + 1;
    candidates.forEach((candidate) => { const d = Math.abs(candidate - value); if (d < distance) { best = candidate; distance = d; } });
    return distance <= threshold ? best : value;
  };
  const snappedX = pick(x, xCandidates);
  const snappedY = pick(y, yCandidates);
  if (snappedX !== x) guideX = targetRect.left + (snappedX - state.baseX) + targetRect.width / 2;
  if (snappedY !== y) guideY = targetRect.top + (snappedY - state.baseY) + targetRect.height / 2;
  showLayoutGuides(guideX, guideY);
  return { x: snappedX, y: snappedY };
}

function initLayoutEditor() {
  const button = document.getElementById('layoutEditorButton');
  if (!button) return;
  button.addEventListener('click', () => setLayoutEditing(!document.body.classList.contains('layout-editing')));
  document.getElementById('closeLayoutEditor')?.addEventListener('click', () => setLayoutEditing(false));
  document.getElementById('saveLayoutTemplate')?.addEventListener('click', () => {
    const nameInput = document.getElementById('layoutTemplateName');
    const name = nameInput.value.trim() || `布局 ${new Date().toLocaleString()}`;
    const templates = loadLayoutTemplates();
    templates[name] = readLayoutOffsets();
    localStorage.setItem(LAYOUT_TEMPLATES_KEY, JSON.stringify(templates));
    nameInput.value = name;
    refreshLayoutTemplateSelect();
    document.getElementById('layoutTemplateSelect').value = name;
  });
  document.getElementById('loadLayoutTemplate')?.addEventListener('click', () => {
    const name = document.getElementById('layoutTemplateSelect').value;
    const templates = loadLayoutTemplates();
    if (name && templates[name]) applyLayoutOffsets(templates[name]);
  });
  document.getElementById('deleteLayoutTemplate')?.addEventListener('click', () => {
    const select = document.getElementById('layoutTemplateSelect');
    const name = select.value;
    if (!name) return;
    const templates = loadLayoutTemplates();
    delete templates[name];
    localStorage.setItem(LAYOUT_TEMPLATES_KEY, JSON.stringify(templates));
    refreshLayoutTemplateSelect();
  });
  document.getElementById('resetLayoutTemplate')?.addEventListener('click', () => {
    applyLayoutOffsets({});
  });
  document.addEventListener('pointerdown', (event) => {
    if (!document.body.classList.contains('layout-editing') || event.button !== 0) return;
    const target = event.target.closest('[id]');
    if (!target || target.closest('#layoutEditorPanel') || target.id === 'layoutEditorButton' || target.id === 'canvas') return;
    const rect = target.getBoundingClientRect();
    layoutDragState = { target, rect, startX: event.clientX, startY: event.clientY, baseX: Number(target.dataset.layoutX || 0), baseY: Number(target.dataset.layoutY || 0), moved: false };
    target.classList.add('layout-dragging');
    target.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!layoutDragState) return;
    const dx = event.clientX - layoutDragState.startX;
    const dy = event.clientY - layoutDragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) layoutDragState.moved = true;
    const rawX = Math.round(layoutDragState.baseX + dx);
    const rawY = Math.round(layoutDragState.baseY + dy);
    const snapped = snapLayoutPosition(layoutDragState, rawX, rawY);
    const x = snapped.x;
    const y = snapped.y;
    layoutDragState.target.dataset.layoutX = String(x);
    layoutDragState.target.dataset.layoutY = String(y);
    layoutDragState.target.style.translate = `${x}px ${y}px`;
  }, true);
  document.addEventListener('pointerup', () => {
    if (!layoutDragState) return;
    layoutDragState.target.classList.remove('layout-dragging');
    hideLayoutGuides();
    layoutSuppressClick = layoutDragState.moved;
    layoutDragState = null;
  }, true);
  document.addEventListener('click', (event) => {
    if (layoutSuppressClick) { event.preventDefault(); event.stopPropagation(); layoutSuppressClick = false; }
  }, true);
}

function ensureEditorCompatibilityControls() {
  const ids = ['add-todo-btn','brush-size-range','font-size-range','create-schedule-btn','matter-add-limit-btn','matter-add-schedule-btn','matter-add-todo-btn','matter-clear-btn','matter-mode','matter-render-btn','schedule-classes','schedule-color','schedule-days','schedule-font-decrease-btn','schedule-font-increase-btn','schedule-font-size','schedule-input','schedule-input-cancel-btn','schedule-input-confirm-btn','schedule-mode','schedule-move-down-btn','schedule-move-left-btn','schedule-move-right-btn','schedule-move-up-btn','schedule-zoom-in-btn','schedule-zoom-out-btn','todo-bold','todo-color','todo-font-size','todo-font-size-range','todo-input','todo-italic','todo-mode','toggle-schedule-cell-indicator-btn','toggle-todo-delete-btn'];
  const selectIds = new Set(['schedule-color']);
  for (const id of ids) {
    if (document.getElementById(id)) continue;
    const el = document.createElement(selectIds.has(id) ? 'select' : (id.endsWith('-btn') || id.endsWith('-mode') ? 'button' : 'input'));
    el.id = id;
    if (el.tagName === 'INPUT') { el.type = 'text'; el.value = '12'; }
    el.hidden = true;
    document.body.appendChild(el);
  }
}

if (typeof document !== 'undefined') document.body.onload = () => {
  textDecoder = null;
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext("2d");

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ensureEditorCompatibilityControls();
  paintManager = new PaintManager(canvas, ctx);
  cropManager = new CropManager(canvas, ctx, paintManager);
  cropManager.setRenderCallback((sourceImageData, commitHistory = true) => {
    // Every completed drag/zoom/rotation must pass through the same dither
    // pipeline as the initial image load.
    ctx.putImageData(sourceImageData, 0, 0);
    ditherSourceImageData = new ImageData(
      new Uint8ClampedArray(sourceImageData.data),
      sourceImageData.width,
      sourceImageData.height
    );
    convertDithering(commitHistory);
  });

  paintManager.initPaintTools();
  cropManager.initCropTools();
  initEventHandlers();
  document.getElementById('batteryStatus')?.addEventListener('click', () => { void refreshBatteryStatus(); });
  updateButtonStatus();
  checkDebugMode();
  initPageBackground();
  initLayoutEditor();
}

if (typeof module !== 'undefined') module.exports.__slotProtocolTest = {
  SLOT_PAGE_SIZE,
  SLOT_READ_MAX_RETRIES,
  encodeSlotAction,
  encodeSlotIndex,
  normalizeSlotFingerprint,
  parseSlotsMessage,
  parseImageMetadata,
  slotPageStart,
  slotControlsDisabled,
  assembleSlotChunk,
  createSerialQueue,
  shouldSyncAfterActivation,
};
