/**
 * Main orchestration module for PhosphorGrid Simulator.
 * Wires together: engine, controls, presets, file handling,
 * split-view drag, RAF animation loop, and ResizeObserver.
 */

import { PhosphorGrid }                   from './engine';
import { bindControls, type ControlValues } from './controls';
import { PRESETS }                         from './presets';

// ── DOM references ────────────────────────────────────────────
const fileInput     = document.getElementById('file-input')      as HTMLInputElement;
const videoInput    = document.getElementById('video-input')     as HTMLInputElement | null;
const imgSource     = document.getElementById('img-source')      as HTMLImageElement;
const canvasTarget  = document.getElementById('canvas-target')   as HTMLCanvasElement;
const origRes       = document.getElementById('orig-res')        as HTMLSpanElement;
const targetRes     = document.getElementById('target-res')      as HTMLSpanElement;
const btnDownload   = document.getElementById('btn-download')    as HTMLButtonElement;
const modeFit       = document.getElementById('mode-fit')        as HTMLInputElement;
const modeInspect   = document.getElementById('mode-inspect')    as HTMLInputElement;
const jsonArea      = document.getElementById('json-config-area')as HTMLTextAreaElement;
const btnCopyJson   = document.getElementById('btn-copy-json')   as HTMLButtonElement;
const btnImportJson = document.getElementById('btn-import-json') as HTMLButtonElement;
const splitHint     = document.getElementById('split-hint')      as HTMLElement | null;
const canvasContainer = canvasTarget.parentElement as HTMLElement;

// ── Engine + state ────────────────────────────────────────────
const engine     = new PhosphorGrid({ canvas: canvasTarget });
let activeSource : HTMLImageElement | HTMLVideoElement | null = null;
let splitX       = 0.0;     // 0 = full phosphor, >0 = split UV position
let rafId        : number | null = null;
const t0         = performance.now();

// ── Color temperature (Tanner Helland algorithm) ──────────────
function tempToRGB(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const r = t <= 66
    ? 1.0
    : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592) / 255);

  const g = t <= 66
    ? clamp((99.4708025861 * Math.log(t) - 161.1195681661) / 255)
    : clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492) / 255);

  const b = t >= 66 ? 1.0
    : t <= 19      ? 0.0
    : clamp((138.5177312231 * Math.log(t - 10) - 305.0447927307) / 255);

  return [r, g, b];
}

// ── Animation loop (opt-in: only when noise or flicker > 0) ──
function startLoop(): void {
  if (rafId !== null) return;
  function tick(): void {
    if (!activeSource) { rafId = null; return; }
    const time = (performance.now() - t0) / 1000;
    engine.render(activeSource, modeInspect.checked, time, splitX);
    targetRes.textContent = `${canvasTarget.width} × ${canvasTarget.height}`;
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function stopLoop(): void {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

function currentTime(): number {
  return (performance.now() - t0) / 1000;
}

// ── Controls ──────────────────────────────────────────────────
const { getValues, setValues } = bindControls((values: ControlValues) => {
  pushToEngine(values);
});

function pushToEngine(values: ControlValues): void {
  engine.updateOptions({
    subpixelWidth: values.subpixelWidth,
    gap:           values.gap,
    renderingMode: values.renderingMode,
    sharpness:     values.sharpness,
    bloom:         values.bloom,
    curvature:     values.curvature,
    vignette:      values.vignette,
    scanlines:     values.scanlines,
    maskType:      values.maskType,
    colorTemp:     tempToRGB(values.colorTempK),
    brightness:    values.brightness,
    contrast:      values.contrast,
    saturation:    values.saturation,
    lodBias:       values.lodBias,
    detailBoost:   values.detailBoost,
    noise:         values.noise,
    flicker:       values.flicker,
  });
  process();
}

// ── Core render / process ─────────────────────────────────────
function process(): void {
  if (!activeSource) return;

  const values = getValues();
  const needsLoop = values.noise > 0 || values.flicker > 0;

  // Canvas CSS display mode
  if (modeInspect.checked) {
    canvasTarget.style.width     = 'auto';
    canvasTarget.style.height    = 'auto';
    canvasTarget.style.objectFit = 'none';
    canvasContainer.style.display   = 'block';
    canvasContainer.style.overflow  = 'auto';
  } else {
    canvasTarget.style.width     = '100%';
    canvasTarget.style.height    = '100%';
    canvasTarget.style.objectFit = 'contain';
    canvasContainer.style.display   = 'flex';
    canvasContainer.style.overflow  = 'hidden';
  }

  if (needsLoop) {
    startLoop();
  } else {
    stopLoop();
    engine.render(activeSource, modeInspect.checked, currentTime(), splitX);
    targetRes.textContent = `${canvasTarget.width} × ${canvasTarget.height}`;
  }

  // Sync JSON preview
  if (jsonArea) {
    jsonArea.value = JSON.stringify(
      { ...engine.getOptions(), colorTempK: getValues().colorTempK },
      null, 2
    );
  }

  if (splitHint) splitHint.style.display = 'block';
  btnDownload.style.display = 'flex';
}

modeFit.addEventListener('change', process);
modeInspect.addEventListener('change', process);

// ── Split-view drag ───────────────────────────────────────────
// Click & drag anywhere on the canvas to set the comparison split.
// Double-click resets to full phosphor.

let isDragging = false;

canvasContainer.addEventListener('pointerdown', (e: PointerEvent) => {
  if (!activeSource) return;
  isDragging = true;
  canvasContainer.setPointerCapture(e.pointerId);
  updateSplit(e);
  canvasContainer.style.cursor = 'col-resize';
});

canvasContainer.addEventListener('pointermove', (e: PointerEvent) => {
  if (!isDragging) return;
  updateSplit(e);
});

canvasContainer.addEventListener('pointerup', () => {
  isDragging = false;
  canvasContainer.style.cursor = 'col-resize';
});

canvasContainer.addEventListener('dblclick', () => {
  splitX = 0.0;
  if (!rafId && activeSource) {
    engine.render(activeSource, modeInspect.checked, currentTime(), splitX);
  }
});

function updateSplit(e: PointerEvent): void {
  const rect = canvasContainer.getBoundingClientRect();
  splitX = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
  if (!rafId && activeSource) {
    engine.render(activeSource, modeInspect.checked, currentTime(), splitX);
  }
}

// ── File loading ──────────────────────────────────────────────
function loadImageFile(file: File): void {
  const reader = new FileReader();
  reader.onload = (e) => {
    imgSource.src = e.target?.result as string;
    imgSource.style.display = 'block';
    imgSource.onload = () => {
      activeSource = imgSource;
      splitX = 0.5; // Show split on first load so user immediately sees the comparison
      origRes.textContent = `${imgSource.naturalWidth} × ${imgSource.naturalHeight}`;
      process();
    };
  };
  reader.readAsDataURL(file);
}

function loadVideoFile(file: File): void {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  video.onloadeddata = () => {
    activeSource = video;
    splitX = 0.5;
    origRes.textContent = `${video.videoWidth} × ${video.videoHeight}`;
    void video.play();
    startLoop(); // Video always needs RAF
    if (splitHint) splitHint.style.display = 'block';
    btnDownload.style.display = 'flex';
  };
}

fileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) loadImageFile(file);
});

videoInput?.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) loadVideoFile(file);
});

// ── Drag & Drop ───────────────────────────────────────────────
const dropOverlay = document.getElementById('drop-overlay');

document.body.addEventListener('dragenter', (e) => {
  if (e.dataTransfer?.types.includes('Files')) {
    dropOverlay?.classList.add('visible');
  }
});

document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.body.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dropOverlay?.classList.remove('visible');
});

document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  dropOverlay?.classList.remove('visible');
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  if (file.type.startsWith('video/')) loadVideoFile(file);
  else if (file.type.startsWith('image/')) loadImageFile(file);
});

// ── Download ──────────────────────────────────────────────────
btnDownload.addEventListener('click', () => {
  if (!activeSource) return;

  const wasLooping = rafId !== null;
  stopLoop();

  // Export at full inspect resolution, no split
  engine.render(activeSource, true, 0, 0);

  const dataUrl = canvasTarget.toDataURL('image/png');
  const a = document.createElement('a');
  a.href     = dataUrl;
  a.download = 'phosphor-grid-export.png';
  a.click();

  // Restore display mode
  if (wasLooping) startLoop();
  else process();
});

// ── Presets ───────────────────────────────────────────────────
PRESETS.forEach(preset => {
  const btn = document.getElementById(`preset-${preset.id}`);
  if (!btn) return;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setValues(preset);
    pushToEngine(getValues());
  });
});

// ── JSON Import / Export ──────────────────────────────────────
btnCopyJson.addEventListener('click', () => {
  navigator.clipboard.writeText(jsonArea.value).then(() => {
    const orig = btnCopyJson.textContent!;
    btnCopyJson.textContent = 'Copied!';
    setTimeout(() => (btnCopyJson.textContent = orig), 1200);
  });
});

btnImportJson.addEventListener('click', () => {
  try {
    const config = JSON.parse(jsonArea.value) as Partial<ControlValues>;
    setValues(config);
    pushToEngine(getValues());
    const orig = btnImportJson.textContent!;
    btnImportJson.textContent = 'Applied!';
    setTimeout(() => (btnImportJson.textContent = orig), 1200);
  } catch {
    alert('Invalid JSON preset configuration!');
  }
});

// ── ResizeObserver: re-render on container resize ─────────────
const ro = new ResizeObserver(() => {
  if (activeSource && !rafId) process();
});
ro.observe(canvasContainer);
