'use strict';

// ── DOM references ──────────────────────────────────────────────
const setupScreen    = document.getElementById('setup-screen');
const timerScreen    = document.getElementById('timer-screen');
const waitingScreen  = document.getElementById('waiting-screen');
const durationInput  = document.getElementById('duration');
const startBtn       = document.getElementById('start-btn');
const stopBtn        = document.getElementById('stop-btn');
const waitingStopBtn = document.getElementById('waiting-stop-btn');
const timeDisplay    = document.getElementById('time-display');
const progressBar    = document.getElementById('progress-bar');
const startAtToggle  = document.getElementById('start-at-toggle');
const startAtTime    = document.getElementById('start-at-time');
const waitingDisplay = document.getElementById('waiting-display');

// ── State ───────────────────────────────────────────────────────
let totalSeconds  = 0;   // configured talk duration in seconds
let remainingMs   = 0;   // milliseconds left (goes negative = overtime)
let rafId         = null;
let lastTimestamp = null;
let wakeLock      = null;
let vibratedWarning = false;  // true once we vibrate at ≤ 10 min
let vibratedDanger  = false;  // true once we vibrate at ≤  5 min
let waitingIntervalId = null; // interval for the waiting countdown

// ── Wake Lock ───────────────────────────────────────────────────
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', onVisibilityChange);
  } catch (_) {
    // Wake lock not supported or denied — silent fallback
  }
}

async function onVisibilityChange() {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await acquireWakeLock();
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Format a total number of seconds (possibly negative) as [−]MM:SS.
 */
function formatTime(totalSec) {
  const negative = totalSec < 0;
  const abs = Math.abs(totalSec);
  const m   = Math.floor(abs / 60);
  const s   = abs % 60;
  return `${negative ? '−' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Update background colour based on remaining time:
 *   ≤ 10 min remaining (remainingSec ≤ 600)  → dark orange  (warning)
 *   ≤  5 min remaining (remainingSec ≤ 300)  → red          (danger)
 */
function applyBackground(remainingSec) {
  timerScreen.classList.remove('warning', 'danger');
  if (remainingSec <= 300) {
    timerScreen.classList.add('danger');
  } else if (remainingSec <= 600) {
    timerScreen.classList.add('warning');
  }
}

/**
 * Vibrate the device at key thresholds (once per threshold).
 *   ≤ 10 min remaining → "two tone"  vibration
 *   ≤  5 min remaining → "four tone" vibration
 * Uses the Web Vibration API; silently ignored on unsupported devices.
 */
function checkVibration(remainingSec) {
  if (!navigator.vibrate) return;

  if (remainingSec <= 300 && !vibratedDanger) {
    vibratedDanger = true;
    // Four-tone pattern: vibrate, pause, vibrate, pause, vibrate, pause, vibrate
    navigator.vibrate([200, 100, 200, 100, 200, 100, 200]);
  } else if (remainingSec <= 600 && !vibratedWarning) {
    vibratedWarning = true;
    // Two-tone pattern: vibrate, pause, vibrate
    navigator.vibrate([200, 100, 200]);
  }
}

/**
 * Update the grey progress bar width.
 * 100% = full time remaining, 0% = time expired (clamped, not negative).
 */
function updateProgressBar(remainingSec) {
  const pct = Math.max(0, (remainingSec / totalSeconds) * 100);
  progressBar.style.width = pct + '%';
  progressBar.setAttribute('aria-valuenow', Math.round(pct));
}

// ── Animation loop ───────────────────────────────────────────────
function tick(timestamp) {
  if (lastTimestamp === null) lastTimestamp = timestamp;

  remainingMs  -= timestamp - lastTimestamp;
  lastTimestamp  = timestamp;

  const remainingSec = Math.ceil(remainingMs / 1000);

  timeDisplay.textContent = formatTime(remainingSec);
  updateProgressBar(remainingSec);
  applyBackground(remainingSec);
  checkVibration(remainingSec);

  rafId = requestAnimationFrame(tick);
}

// ── Start / Stop ─────────────────────────────────────────────────
function startTimer() {
  const minutes = parseInt(durationInput.value, 10);
  if (!Number.isFinite(minutes) || minutes < 1) return;

  // If "start at time" is active, enter waiting stage instead
  if (startAtToggle.checked) {
    const timeVal = startAtTime.value;
    if (!timeVal) return;           // no time entered
    startWaiting(minutes, timeVal);
    return;
  }

  beginCountdown(minutes);
}

/** Actually start the talk countdown (called directly or after waiting). */
function beginCountdown(minutes) {
  totalSeconds  = minutes * 60;
  remainingMs   = totalSeconds * 1000;
  lastTimestamp = null;
  vibratedWarning = false;
  vibratedDanger  = false;

  timerScreen.classList.remove('warning', 'danger');
  setupScreen.classList.add('hidden');
  waitingScreen.classList.add('hidden');
  timerScreen.classList.remove('hidden');

  progressBar.style.width = '100%';
  progressBar.setAttribute('aria-valuenow', 100);
  timeDisplay.textContent = formatTime(totalSeconds);

  rafId = requestAnimationFrame(tick);
  acquireWakeLock();
}

// ── Waiting stage ────────────────────────────────────────────────

/**
 * Enter the waiting stage: show a "Start in" countdown until the
 * specified wall-clock time, then auto-start the timer.
 */
function startWaiting(minutes, timeVal) {
  const [h, m] = timeVal.split(':').map(Number);
  const now    = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);

  // If the target time is already past today, treat it as tomorrow
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  setupScreen.classList.add('hidden');
  waitingScreen.classList.remove('hidden');

  acquireWakeLock();

  function updateWaiting() {
    const diffMs  = target.getTime() - Date.now();
    if (diffMs <= 0) {
      clearInterval(waitingIntervalId);
      waitingIntervalId = null;
      beginCountdown(minutes);
      return;
    }
    const totalSec = Math.ceil(diffMs / 1000);
    waitingDisplay.textContent = formatTime(totalSec);
  }

  updateWaiting();                           // show immediately
  waitingIntervalId = setInterval(updateWaiting, 1000); // update once/s
}

function stopWaiting() {
  if (waitingIntervalId !== null) {
    clearInterval(waitingIntervalId);
    waitingIntervalId = null;
  }
  releaseWakeLock();
  waitingScreen.classList.add('hidden');
  setupScreen.classList.remove('hidden');
}

function stopTimer() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  lastTimestamp = null;

  releaseWakeLock();

  timerScreen.classList.add('hidden');
  timerScreen.classList.remove('warning', 'danger');
  setupScreen.classList.remove('hidden');
}

// ── Event listeners ──────────────────────────────────────────────
startBtn.addEventListener('click', startTimer);
stopBtn.addEventListener('click', stopTimer);
waitingStopBtn.addEventListener('click', stopWaiting);

startAtToggle.addEventListener('change', () => {
  startAtTime.classList.toggle('hidden', !startAtToggle.checked);
});

durationInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startTimer();
});

startAtTime.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startTimer();
});
