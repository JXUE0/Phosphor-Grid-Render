/**
 * Main orchestration module for PhosphorGrid Simulator.
 *
 * Key subsystems:
 *  - Engine: GPU WebGL renderer (engine.ts)
 *  - Webcam: live getUserMedia() source, funneled into the video pipeline
 *  - Controls: slider/radio/select DOM bindings (controls.ts)
 *  - Presets: 6 authentic monitor presets (presets.ts)
 *  - Video loop: requestVideoFrameCallback (RVFC) with RAF fallback
 *  - Split-view drag: pointer events on canvas container
 *  - Drag & drop: anywhere on the page
 *  - Comparison mode: side-by-side original vs processed view
 */

import { PhosphorGrid }                    from './engine';
import { bindControls, type ControlValues } from './controls';
import { PRESETS }                          from './presets';
import { isMobileDevice }                   from './device';

// ── DOM references ─────────────────────────────────────────────
const fileInput      = document.getElementById('file-input')       as HTMLInputElement;
const videoInput     = document.getElementById('video-input')      as HTMLInputElement | null;
const imgSource      = document.getElementById('img-source')       as HTMLImageElement;
const canvasTarget   = document.getElementById('canvas-target')    as HTMLCanvasElement;
const origRes        = document.getElementById('orig-res')         as HTMLSpanElement;
const targetRes      = document.getElementById('target-res')       as HTMLSpanElement;
const btnDownload    = document.getElementById('btn-download')     as HTMLButtonElement;
const modeFit        = document.getElementById('mode-fit')         as HTMLInputElement;
const modeInspect    = document.getElementById('mode-inspect')     as HTMLInputElement;
const jsonArea       = document.getElementById('json-config-area') as HTMLTextAreaElement;
const btnCopyJson    = document.getElementById('btn-copy-json')    as HTMLButtonElement;
const btnImportJson  = document.getElementById('btn-import-json')  as HTMLButtonElement;
const splitHint      = document.getElementById('split-hint')       as HTMLElement | null;
const container      = document.getElementById('canvas-container') as HTMLElement;

// Video-specific UI
const videoControls  = document.getElementById('video-controls')   as HTMLElement | null;
const btnPlayPause   = document.getElementById('btn-play-pause')   as HTMLButtonElement | null;
const videoSpeed     = document.getElementById('video-speed')      as HTMLInputElement | null;
const valSpeed       = document.getElementById('val-speed')        as HTMLSpanElement | null;
const videoTime      = document.getElementById('video-time')       as HTMLSpanElement | null;
const videoSpeedRow  = document.querySelector('.vc-speed')         as HTMLElement | null;
const liveBadge      = document.getElementById('live-badge')       as HTMLSpanElement | null;
const colorspaceSelect = document.getElementById('param-colorspace') as HTMLSelectElement | null;

// Webcam-specific UI
const btnWebcam      = document.getElementById('btn-webcam')       as HTMLButtonElement | null;
const btnStopWebcam  = document.getElementById('btn-stop-webcam')  as HTMLButtonElement | null;
const webcamVideoEl  = document.getElementById('webcam-source')    as HTMLVideoElement;

// Diagnostics elements
const statFps = document.getElementById('stat-fps') as HTMLSpanElement | null;
const statMs  = document.getElementById('stat-ms')  as HTMLSpanElement | null;
const statGpu = document.getElementById('stat-gpu') as HTMLSpanElement | null;
const perfTierSelect = document.getElementById('perf-tier') as HTMLSelectElement | null;

// Comparison mode controls
const btnCompare = document.getElementById('btn-compare') as HTMLButtonElement | null;
const compareLabel = document.getElementById('compare-label') as HTMLSpanElement | null;

// ── Engine + state ─────────────────────────────────────────────
const engine          = new PhosphorGrid({ canvas: canvasTarget });
let activeSource      : HTMLImageElement | HTMLVideoElement | null = null;
let activeVideo       : HTMLVideoElement | null = null;  // only set when video is active
let webcamStream      : MediaStream | null = null;
let isLiveStream       = false;
let splitX            = 0.0;
let isComparing       = false; // NEW: comparison mode state
let splitXBeforeCompare = 0.0; // Stores splitX value when entering comparison mode
let imageLoadGeneration = 0; // Generation counter to prevent stale image load callbacks
let videoLoadGeneration = 0; // Generation counter to prevent stale video load callbacks
let rafId             : number | null = null;
let rvfcHandle        : number | null = null;
const t0              = performance.now();

// FPS / Render time tracking variables
let frameCount = 0;
let lastFpsUpdate = performance.now();
const renderTimes: number[] = [];

// ── Utility: current animation time ────────────────────────────
let lastKnownFrameTime = performance.now();
function currentTime(): number {
  return (lastKnownFrameTime - t0) / 1000;
}

// ── Color temperature (Tanner Helland algorithm) ───────────────
function tempToRGB(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  const r = t <= 66 ? 1.0 : cl(329.698727446 * Math.pow(t - 60, -0.1332047592) / 255);
  const g = t <= 66
    ? cl((99.4708025861 * Math.log(t) - 161.1195681661) / 255)
    : cl(288.1221695283 * Math.pow(t - 60, -0.0755148492) / 255);
  const b = t >= 66 ? 1.0 : t <= 19 ? 0.0
    : cl((138.5177312231 * Math.log(t - 10) - 305.0447927307) / 255);
  return [r, g, b];
}

// ── Performance tier (manual, replaces resolution-based auto-scaling) ─
// The canvas is ALWAYS rendered at full display resolution — quality tier
// only gates optional cosmetic shader passes (grain, detail-boost, GPU
// profiling), so the split-view "original" reference never degrades.
type PerformanceTier = 'low' | 'medium' | 'high';
const TIER_LEVEL: Record<PerformanceTier, number> = { low: 0, medium: 1, high: 2 };
const TIER_ORDER: PerformanceTier[] = ['low', 'medium', 'high'];

let perfPreference: PerformanceTier | 'auto' = 'auto';
let activeTier: PerformanceTier = isMobileDevice ? 'medium' : 'high';
let lastTierCheck = performance.now();

function currentQualityLevel(): number {
  return TIER_LEVEL[activeTier];
}

// ── Smooth Motion (temporal frame blending) + FSR-style sharpen ────
// "Smooth Motion" decouples the render loop from the video's decode rate:
// requestVideoFrameCallback pushes each decoded frame into the engine, while
// a separate RAF loop renders at display refresh rate, blending toward the
// most recent frame as time elapses — a lightweight, GPU-cheap alternative to
// true motion-vector frame generation (DLSS/FSR frame gen), closer to the
// "frame blending" motion smoothing found on many TVs/video players.
let smoothMotionEnabled = false;
let upscaleSharpenEnabled = false;

const chkSmoothMotion   = document.getElementById('chk-smooth-motion')   as HTMLInputElement | null;
const chkUpscaleSharpen = document.getElementById('chk-upscale-sharpen') as HTMLInputElement | null;

chkSmoothMotion?.addEventListener('change', () => {
  smoothMotionEnabled = chkSmoothMotion.checked;
  // Switch loops live if a video is already playing
  if (activeVideo && !activeVideo.paused) startVideoLoop(activeVideo);
});

chkUpscaleSharpen?.addEventListener('change', () => {
  upscaleSharpenEnabled = chkUpscaleSharpen.checked;
  if (activeSource && !rafId && !rvfcHandle) {
    engine.render(activeSource, modeInspect.checked, currentTime(), splitX, currentQualityLevel(), 1.0, upscaleSharpenEnabled);
  }
});

perfTierSelect?.addEventListener('change', () => {
  const v = perfTierSelect.value as PerformanceTier | 'auto';
  perfPreference = v;
  if (v !== 'auto') activeTier = v;
  // Dropping to a lower tier must shrink an already-open comparator immediately —
  // otherwise it keeps more WebGL contexts alive than the new tier allows.
  if (comparatorOverlay && comparatorOverlay.style.display !== 'none') {
    rebuildComparatorCanvases();
  }
});

function trackMetrics(tRenderStart: number): void {
  const now = performance.now();
  const renderDuration = now - tRenderStart;
  renderTimes.push(renderDuration);
  if (renderTimes.length > 30) renderTimes.shift();

  frameCount++;
  if (now - lastFpsUpdate >= 1000) {
    const fps = (frameCount * 1000) / (now - lastFpsUpdate);
    const avgMs = renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length;
    if (statFps) statFps.textContent = `${fps.toFixed(1)} fps`;
    if (statMs)  statMs.textContent = `${avgMs.toFixed(1)} ms`;

    // Auto mode: step the tier discretely based on measured FPS. Never
    // touches canvas resolution — only which cosmetic passes are enabled.
    if (perfPreference === 'auto' && now - lastTierCheck > 2000) {
      const idx = TIER_ORDER.indexOf(activeTier);
      if (fps < 45.0 && idx > 0) {
        activeTier = TIER_ORDER[idx - 1];
      } else if (fps > 55.0 && idx < TIER_ORDER.length - 1) {
        activeTier = TIER_ORDER[idx + 1];
      }
      lastTierCheck = now;
    }

    frameCount = 0;
    lastFpsUpdate = now;
  }
}

function updateGpuStat(): void {
  if (!statGpu) return;
  const gpuMs = engine.getGPUTimeMs();
  const subimg = engine.isUsingSubImage() ? ' · SubImage' : '';
  const tierLabel = perfPreference === 'auto' ? `Auto (${activeTier})` : activeTier;
  statGpu.textContent = gpuMs !== null
    ? `${tierLabel} · GPU ${gpuMs.toFixed(2)}ms${subimg}`
    : `${tierLabel}${subimg}`;
}

function startLoop(): void {
  if (rafId !== null) return;
  const tick = (timestamp: DOMHighResTimeStamp) => {
    if (!activeSource) { rafId = null; return; }
    lastKnownFrameTime = timestamp;

    const tStart = performance.now();

    // Use existing split-view feature: when comparing, show original (left) vs processed (right)
    const effectiveSplitX = isComparing ? 0.5 : splitX;

    engine.render(activeSource, modeInspect.checked, currentTime(), effectiveSplitX, currentQualityLevel(), 1.0, upscaleSharpenEnabled);

    targetRes.textContent = `${canvasTarget.width} × ${canvasTarget.height}`;

    updateGpuStat();

    trackMetrics(tStart);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopLoop(): void {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

// ── RVFC video loop (requestVideoFrameCallback) ────────────────
type RVFCCallback = (now: DOMHighResTimeStamp, metadata?: unknown) => void;

function startVideoLoop(video: HTMLVideoElement): void {
  const supportsRVFC = 'requestVideoFrameCallback' in video;

  if (smoothMotionEnabled && supportsRVFC) {
    startSmoothVideoLoop(video);
    return;
  }

  stopLoop();
  stopRVFC();
  engine.resetVideoFrameState();

  if (supportsRVFC) {
    const onFrame: RVFCCallback = (now) => {
      if (activeSource !== video) return; // source changed
      lastKnownFrameTime = now;
      const tStart = performance.now();

      // Use existing split-view feature: when comparing, show original (left) vs processed (right)
      const effectiveSplitX = isComparing ? 0.5 : splitX;

      engine.render(video, modeInspect.checked, currentTime(), effectiveSplitX, currentQualityLevel(), 1.0, upscaleSharpenEnabled);

      targetRes.textContent = `${canvasTarget.width} × ${canvasTarget.height}`;

      updateVideoTime(video);

      updateGpuStat();

      trackMetrics(tStart);
      if (!video.paused && activeSource === video) {
        rvfcHandle = (video as any).requestVideoFrameCallback(onFrame);
      }
    };
    rvfcHandle = (video as any).requestVideoFrameCallback(onFrame);
  } else {
    // Fallback: RAF
    const tick = (timestamp: DOMHighResTimeStamp) => {
      if (!activeSource || activeSource !== video) { rafId = null; return; }
      lastKnownFrameTime = timestamp;
      const tStart = performance.now();

      // Use existing split-view feature: when comparing, show original (left) vs processed (right)
      const effectiveSplitX = isComparing ? 0.5 : splitX;

      engine.render(video, modeInspect.checked, currentTime(), effectiveSplitX, currentQualityLevel(), 1.0, upscaleSharpenEnabled);

      targetRes.textContent = `${canvasTarget.width} × ${canvasTarget.height}`;

      updateVideoTime(video);

      updateGpuStat();

      trackMetrics(tStart);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
}

// ── RVFC helper functions ──────────────────────────────────────
function stopRVFC(): void {
  if (rvfcHandle !== null && activeVideo) {
    const v = activeVideo as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    v.cancelVideoFrameCallback?.(rvfcHandle);
    rvfcHandle = null;
  }
}

function startSmoothVideoLoop(video: HTMLVideoElement): void {
  stopLoop();
  stopRVFC();
  engine.resetVideoFrameState();

  let lastPushTime = performance.now();
  let estIntervalMs = 1000 / 30; // rolling estimate, seeded at 30fps

  const onVideoFrame: RVFCCallback = () => {
    if (activeSource !== video) return;
    const t = performance.now();
    const dt = t - lastPushTime;
    // Ignore outlier gaps (seek/pause/stall) so the estimate doesn't get skewed
    if (dt > 4 && dt < 250) estIntervalMs = estIntervalMs * 0.8 + dt * 0.2;
    lastPushTime = t;
    engine.pushVideoFrame(video);
    if (!video.paused && activeSource === video) {
      rvfcHandle = (video as any).requestVideoFrameCallback(onVideoFrame);
    }
  };
  rvfcHandle = (video as any).requestVideoFrameCallback(onVideoFrame);

  const tick = (timestamp: DOMHighResTimeStamp) => {
    if (!activeSource || activeSource !== video) { rafId = null; return; }
    lastKnownFrameTime = timestamp;
    const tStart = performance.now();
    const mix = Math.max(0, Math.min(1, (tStart - lastPushTime) / estIntervalMs));

    // Use existing split-view feature: when comparing, show original (left) vs processed (right)
    const effectiveSplitX = isComparing ? 0.5 : splitX;

    engine.render(video, modeInspect.checked, currentTime(), effectiveSplitX, currentQualityLevel(), mix, upscaleSharpenEnabled);

    targetRes.textContent = `${canvasTarget.width} × ${canvasTarget.height}`;

    updateVideoTime(video);

    updateGpuStat();

    trackMetrics(tStart);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

// ── Controls ───────────────────────────────────────────────────
const { getValues, setValues } = bindControls((values: ControlValues) => {
  pushToEngine(values);
});

function pushToEngine(values: ControlValues): void {
  const cs = (colorspaceSelect?.value ?? 'srgb') as 'srgb' | 'linear' | 'hdr';
  engine.updateOptions({
    subpixelWidth:    values.subpixelWidth,
    gap:              values.gap,
    renderingMode:    values.renderingMode,
    sharpness:        values.sharpness,
    bloom:            values.bloom,
    curvature:        values.curvature,
    vignette:        values.vignette,
    scanlines:        values.scanlines,
    maskType:         values.maskType,
    colorTemp:        tempToRGB(values.colorTempK),
    brightness:       values.brightness,
    contrast:         values.contrast,
    saturation:       values.saturation,
    lodBias:          values.lodBias,
    detailBoost:      values.detailBoost,
    noise:            values.noise,
    flicker:          values.flicker,
    outputColorspace: cs,
  });
  process();
}

// ── Core process — decides loop strategy ───────────────────────
function process(): void {
  if (!activeSource) return;

  const values = getValues();
  // Video always needs a loop; static images only if noise/flicker are active
  const isVideo = activeSource instanceof HTMLVideoElement;
  const needsLoop = isVideo || values.noise > 0 || values.flicker > 0;

  // Canvas CSS display mode
  if (modeInspect.checked) {
    canvasTarget.style.width     = 'auto';
    canvasTarget.style.height    = 'auto';
    canvasTarget.style.objectFit = 'none';
    // Block layout (not flex) — the magnifier's pan/zoom transform assumes the
    // canvas's untransformed position is the container's top-left corner.
    // Flex's default centering would offset that base position and throw the
    // whole pan/zoom math off.
    container.style.display   = 'block';
    container.style.overflow  = 'hidden';
    container.style.cursor    = 'grab';
    applyMagnifyTransform();
  } else {
    canvasTarget.style.width     = '100%';
    canvasTarget.style.height    = '100%';
    canvasTarget.style.objectFit = 'contain';
    container.style.display   = 'flex';
    container.style.overflow  = 'hidden';
    container.style.cursor    = 'col-resize';
    canvasTarget.style.transform    = 'none';
  }

  if (isVideo && activeVideo) {
    if (activeVideo.paused) {
      // If paused, render one still frame immediately so parameters update live
      // Use existing split-view feature: when comparing, show original (left) vs processed (right)
      const effectiveSplitX = isComparing ? 0.5 : splitX;
      engine.render(activeVideo, modeInspect.checked, currentTime(), effectiveSplitX, currentQualityLevel(), 1.0, upscaleSharpenEnabled);
      targetRes.textContent = `${canvasTarget.width} × ${canvasTarget.height}`;
    } else {
      startVideoLoop(activeVideo);
    }
  } else if (needsLoop) {
    startLoop();
  } else {
    stopLoop();
    stopRVFC();
    // Use existing split-view feature: when comparing, show original (left) vs processed (right)
    const effectiveSplitX = isComparing ? 0.5 : splitX;
    engine.render(activeSource, modeInspect.checked, currentTime(), effectiveSplitX, currentQualityLevel(), 1.0, upscaleSharpenEnabled);
    targetRes.textContent = `${canvasTarget.width} × ${canvasTarget.height}`;
  }

  // Sync JSON preview
  if (jsonArea) {
    jsonArea.value = JSON.stringify(
      { ...engine.getOptions(), colorTempK: getValues().colorTempK },
      null, 2
    );
  }

  if (splitHint) {
    splitHint.style.display = 'block';
    splitHint.textContent = modeInspect.checked
      ? 'drag to pan · wheel to zoom · dblclick to reset'
      : 'drag to compare original vs phosphor · dblclick to reset';
  }
  btnDownload.style.display = 'flex';
}

// NEW: Handle comparison button click
function toggleCompare(): void {
  if (isComparing) {
    // Exiting comparison mode - restore previous splitX value
    isComparing = false;
    splitX = splitXBeforeCompare;

    if (btnCompare) {
      btnCompare.textContent = '⏸️ Compare View';
    }

    if (compareLabel) {
      compareLabel.textContent = 'OFF';
      compareLabel.style.backgroundColor = 'rgba(255,255,255,0.1)';
    }

    // Restore normal split behavior - splitX controls divider position
    container.style.cursor = modeInspect.checked ? 'grab' : 'col-resize';
  } else {
    // Entering comparison mode - save current splitX and set to 50/50
    splitXBeforeCompare = splitX;
    isComparing = true;

    if (btnCompare) {
      btnCompare.textContent = '▶️ Normal View';
    }

    if (compareLabel) {
      compareLabel.textContent = 'ON';
      compareLabel.style.backgroundColor = 'rgba(245,158,11,0.2)';
    }

    // Fixed at 50/50 for comparison - disable split dragging
    splitX = 0.5;
    container.style.cursor = 'default';
  }

  // Trigger immediate re-render
  if (activeSource && !rafId && !rvfcHandle) {
    process();
  }
}

// Initialize comparison button if it exists
if (btnCompare && compareLabel) {
  btnCompare.addEventListener('click', toggleCompare);
  // Set initial state
  compareLabel.textContent = 'OFF';
  compareLabel.style.backgroundColor = 'rgba(255,255,255,0.1)';
}

// ── Event listeners ────────────────────────────────────────────
modeFit.addEventListener('change', () => { resetMagnify(); process(); });
modeInspect.addEventListener('change', () => { resetMagnify(); process(); });

// ── Color space selector ───────────────────────────────────────
colorspaceSelect?.addEventListener('change', () => {
  pushToEngine(getValues());
});

// ── Video controls ─────────────────────────────────────────────
function updateVideoUI(video: HTMLVideoElement | null, live = false): void {
  if (!videoControls) return;
  videoControls.style.display = video ? 'flex' : 'none';
  // Live streams have no meaningful pause/seek/speed — hide those controls
  if (btnPlayPause)  btnPlayPause.style.display  = live ? 'none' : '';
  if (videoSpeedRow) videoSpeedRow.style.display = live ? 'none' : '';
  if (videoTime)     videoTime.style.display     = live ? 'none' : '';
  if (liveBadge)     liveBadge.style.display     = live ? 'inline' : 'none';
  updatePlayPauseBtn(video);
}

function updatePlayPauseBtn(video: HTMLVideoElement | null): void {
  if (!btnPlayPause) return;
  if (!video) { btnPlayPause.textContent = '▶'; return; }
  btnPlayPause.textContent = video.paused ? '▶ Play' : '⏸ Pause';
}

function updateVideoTime(video: HTMLVideoElement): void {
  if (!videoTime) return;
  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  videoTime.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration || 0)}`;
}

btnPlayPause?.addEventListener('click', () => {
  if (!activeVideo) return;
  if (activeVideo.paused) {
    void activeVideo.play().then(() => {
      updatePlayPauseBtn(activeVideo);
      // Restart RVFC after play (RVFC stops when video pauses)
      if (activeVideo) startVideoLoop(activeVideo);
    });
  } else {
    activeVideo.pause();
    updatePlayPauseBtn(activeVideo);
    // Render one still frame while paused so the canvas updates immediately
    // Use existing split-view feature: when comparing, show original (left) vs processed (right)
    const effectiveSplitX = isComparing ? 0.5 : splitX;
    engine.render(activeVideo, modeInspect.checked, currentTime(), effectiveSplitX, currentQualityLevel(), 1.0, upscaleSharpenEnabled);
  }
});

videoSpeed?.addEventListener('input', () => {
  const speed = parseFloat(videoSpeed.value);
  if (valSpeed) valSpeed.textContent = `${speed.toFixed(2)}×`;
  if (activeVideo) activeVideo.playbackRate = speed;
});

// ── Inspect magnifier (wheel-zoom + drag-pan via CSS transform) ─
// Pure display-layer pan/zoom over the existing 1:1 inspect canvas — no
// engine.ts/shader changes. Replaces the old native-scroll UX.
let magnifyZoom = 1;
let magnifyPanX = 0;
let magnifyPanY = 0;

function applyMagnifyTransform(): void {
  canvasTarget.style.transformOrigin = '0 0';
  canvasTarget.style.transform = `translate(${magnifyPanX}px, ${magnifyPanY}px) scale(${magnifyZoom})`;
}

function resetMagnify(): void {
  magnifyZoom = 1;
  magnifyPanX = 0;
  magnifyPanY = 0;
  if (modeInspect.checked) applyMagnifyTransform();
}

/** Keeps the zoomed canvas from panning past its own edges. */
function clampMagnifyPan(): void {
  const rect = container.getBoundingClientRect();
  const scaledW = canvasTarget.width  * magnifyZoom;
  const scaledH = canvasTarget.height * magnifyZoom;

  const clampAxis = (pan: number, scaledSize: number, containerSize: number): number =>
    scaledSize <= containerSize
      ? Math.max(0, Math.min(containerSize - scaledSize, pan))
      : Math.max(containerSize - scaledSize, Math.min(0, pan));

  magnifyPanX = clampAxis(magnifyPanX, scaledW, rect.width);
  magnifyPanY = clampAxis(magnifyPanY, scaledH, rect.height);
}

container.addEventListener('wheel', (e: WheelEvent) => {
  if (!modeInspect.checked || !activeSource) return;
  e.preventDefault();

  const rect = container.getBoundingClientRect();
  const cursorX = e.clientX - rect.left;
  const cursorY = e.clientY - rect.top;

  // Canvas-space point under the cursor, before the zoom change
  const anchorX = (cursorX - magnifyPanX) / magnifyZoom;
  const anchorY = (cursorY - magnifyPanY) / magnifyZoom;

  const zoomFactor = Math.exp(-e.deltaY * 0.001);
  magnifyZoom = Math.max(0.1, Math.min(8, magnifyZoom * zoomFactor));

  // Re-anchor pan so the same canvas point stays under the cursor
  magnifyPanX = cursorX - anchorX * magnifyZoom;
  magnifyPanY = cursorY - anchorY * magnifyZoom;

  clampMagnifyPan();
  applyMagnifyTransform();
}, { passive: false });

// ── Split-view drag (Fit mode) / Pan drag (Inspect mode) ────────
let isDragging = false;
let isPanning  = false;
let panPointerStart = { x: 0, y: 0 };
let panOriginStart  = { x: 0, y: 0 };

container.addEventListener('pointerdown', (e: PointerEvent) => {
  if (!activeSource) return;
  container.setPointerCapture(e.pointerId);
  if (modeInspect.checked) {
    isPanning = true;
    panPointerStart = { x: e.clientX, y: e.clientY };
    panOriginStart  = { x: magnifyPanX, y: magnifyPanY };
    container.style.cursor = 'grabbing';
  } else {
    // Only allow dragging if not in comparison mode
    if (!isComparing) {
      isDragging = true;
      updateSplit(e);
      container.style.cursor = 'col-resize';
    }
  }
});

container.addEventListener('pointermove', (e: PointerEvent) => {
  if (isPanning) {
    magnifyPanX = panOriginStart.x + (e.clientX - panPointerStart.x);
    magnifyPanY = panOriginStart.y + (e.clientY - panPointerStart.y);
    clampMagnifyPan();
    applyMagnifyTransform();
    return;
  }
  if (!isDragging || isComparing) return; // Disable dragging during comparison
  updateSplit(e);
});

container.addEventListener('pointerup', () => {
  isDragging = false;
  isPanning  = false;
  container.style.cursor = modeInspect.checked ? 'grab' : 'col-resize';
});

container.addEventListener('dblclick', () => {
  if (modeInspect.checked) {
    resetMagnify();
    return;
  }
  // Only reset split if not in comparison mode
  if (!isComparing) {
    splitX = 0.0;
    container.classList.remove('split-active');
    if (activeSource && !rafId && !rvfcHandle) {
      engine.render(activeSource, modeInspect.checked, currentTime(), splitX, currentQualityLevel(), 1.0, upscaleSharpenEnabled);
    }
  }
});

function updateSplit(e: PointerEvent): void {
  // Don't update split if in comparison mode
  if (isComparing) return;

  const rect = container.getBoundingClientRect();
  splitX = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));

  if (splitX > 0.0) {
    container.classList.add('split-active');
  } else {
    container.classList.remove('split-active');
  }

  // For static images when no loop is running, re-render immediately
  if (activeSource && !rafId && !rvfcHandle && !isComparing) {
    engine.render(activeSource, modeInspect.checked, currentTime(), splitX, currentQualityLevel(), 1.0, upscaleSharpenEnabled);
  }
}

// ── File loading ───────────────────────────────────────────────
/** Stops every render loop and clears the active source — call before switching sources. */
function clearSource(): void {
  stopLoop();
  stopRVFC();
  engine.resetVideoFrameState();
  activeSource = null;  // makes any in-flight RAF/RVFC tick() a no-op immediately
  if (activeVideo) {
    activeVideo.pause();
    activeVideo = null;
  }
  // Single point of exit for the camera — every source switch must release it,
  // otherwise the browser keeps the camera LED on indefinitely.
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
    webcamStream = null;
  }
  if (isLiveStream) {
    isLiveStream = false;
    if (btnWebcam)     btnWebcam.style.display     = '';
    if (btnStopWebcam) btnStopWebcam.style.display = 'none';
  }
  updateVideoUI(null);
  imgSource.style.display = 'none';
  container.classList.remove('split-active');
  // Reset comparison mode when changing sources
  if (isComparing) {
    isComparing = false;
    splitXBeforeCompare = 0.0; // Reset stored splitX value
    if (btnCompare) btnCompare.textContent = '⏸️ Compare View';
    if (compareLabel) {
      compareLabel.textContent = 'OFF';
      compareLabel.style.backgroundColor = 'rgba(255,255,255,0.1)';
    }
  }
}

async function startWebcam(): Promise<void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err) {
    alert('No se pudo acceder a la cámara: ' + (err instanceof Error ? err.message : String(err)));
    return;
  }

  clearSource();
  webcamStream = stream;
  webcamVideoEl.srcObject = stream;
  await new Promise<void>(resolve => {
    webcamVideoEl.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });
  await webcamVideoEl.play();

  activeSource = webcamVideoEl;
  activeVideo  = webcamVideoEl;
  isLiveStream = true;
  splitX       = 0.5;
  container.classList.add('split-active');
  origRes.textContent = `${webcamVideoEl.videoWidth} × ${webcamVideoEl.videoHeight}`;
  btnDownload.textContent = '↓ Export Frame';
  updateVideoUI(webcamVideoEl, true);
  if (btnWebcam)     btnWebcam.style.display     = 'none';
  if (btnStopWebcam) btnStopWebcam.style.display = 'flex';
  startVideoLoop(webcamVideoEl);
}

btnWebcam?.addEventListener('click', () => { void startWebcam(); });
btnStopWebcam?.addEventListener('click', () => { clearSource(); });

function loadImageFile(file: File): void {
  // Increment generation to invalidate any previous load callbacks
  const currentGeneration = ++imageLoadGeneration;

  clearSource();

  const reader = new FileReader();
  reader.onload = (e) => {
    // Only process if this is still the current generation
    if (imageLoadGeneration !== currentGeneration) return;

    imgSource.src = e.target?.result as string;
    imgSource.style.display = 'block';
    imgSource.onload = () => {
      activeSource = imgSource;
      splitX = 0.5;
      container.classList.add('split-active');
      origRes.textContent  = `${imgSource.naturalWidth} × ${imgSource.naturalHeight}`;
      btnDownload.textContent = '↓ Download PNG';
      process();
    };
  };
  reader.readAsDataURL(file);
}

function loadVideoFile(file: File): void {
  // Increment generation to invalidate any previous load callbacks
  const currentGeneration = ++videoLoadGeneration;

  clearSource();

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.loop        = true;
  video.muted       = true;
  video.playsInline = true;
  video.src         = url;

  video.addEventListener('loadedmetadata', () => {
    // Only process if this is still the current generation
    if (videoLoadGeneration !== currentGeneration) return;

    activeSource = video;
    activeVideo  = video;
    splitX       = 0.5;
    container.classList.add('split-active');
    origRes.textContent = `${video.videoWidth} × ${video.videoHeight}`;
    btnDownload.textContent = '↓ Export Frame';
    updateVideoUI(video);
    if (videoSpeed) video.playbackRate = parseFloat(videoSpeed.value);
    if (splitHint) splitHint.style.display = 'block';
    btnDownload.style.display = 'flex';
  });

  video.addEventListener('loadeddata', () => {
    // Only process if this is still the current generation
    if (videoLoadGeneration !== currentGeneration) return;

    void video.play().then(() => {
      updatePlayPauseBtn(video);
      startVideoLoop(video);
    });
  });

  // Keep play/pause button in sync when video state changes externally
  video.addEventListener('pause', () => {
    // Only process if this is still the current generation
    if (videoLoadGeneration !== currentGeneration) return;
    updatePlayPauseBtn(video);
  });
  video.addEventListener('play',  () => {
    // Only process if this is still the current generation
    if (videoLoadGeneration !== currentGeneration) return;
    updatePlayPauseBtn(video);
  });
}

fileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) loadImageFile(file);
});

videoInput?.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) loadVideoFile(file);
});

// ── Drag & Drop ────────────────────────────────────────────────
const dropOverlay = document.getElementById('drop-overlay');

document.body.addEventListener('dragenter', (e) => {
  if (e.dataTransfer?.types.includes('Files')) {
    dropOverlay?.classList.add('visible');
  }
});

document.body.addEventListener('dragover', (e) => { e.preventDefault(); });

document.body.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dropOverlay?.classList.remove('visible');
});

document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  dropOverlay?.classList.remove('visible');
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  if (file.type.startsWith('video/'))      loadVideoFile(file);
  else if (file.type.startsWith('image/')) loadImageFile(file);
});

// ── Download ───────────────────────────────────────────────────
btnDownload.addEventListener('click', () => {
  if (!activeSource) return;

  if (activeSource instanceof HTMLVideoElement) {
    // Video: export the current displayed frame (no mode change needed)
    // The canvas already has the latest rendered frame with preserveDrawingBuffer:true
    const dataUrl = canvasTarget.toDataURL('image/png');
    const a = document.createElement('a');
    a.href     = dataUrl;
    a.download = `phosphor-frame-${Math.floor(activeSource.currentTime * 100)}.png`;
    a.click();
  } else {
    // Image: export at full inspect resolution (1px → 1 triad), no split.
    // Intentionally always High quality (default qualityLevel) regardless of
    // the live-preview performance tier — a deliberate export should get the
    // best cosmetic detail even if the user picked Low for smoother preview.
    const wasLooping = rafId !== null;
    stopLoop();
    // Use existing split-view feature: when comparing, show original (left) vs processed (right)
    // For export, we want full processed (splitX = 0)
    engine.render(activeSource, true, 0, 0);
    const dataUrl = canvasTarget.toDataURL('image/png');
    const a = document.createElement('a');
    a.href     = dataUrl;
    a.download = 'phosphor-grid-export.png';
    a.click();
    // Restore normal display
    if (wasLooping) startLoop();
    else process();
  }
});

// ── Presets ────────────────────────────────────────────────────
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

// ── JSON Import / Export ───────────────────────────────────────
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

// ── Preset Comparator ────────────────────────────────────────────
const btnOpenComparator  = document.getElementById('btn-open-comparator')  as HTMLButtonElement | null;
const btnCloseComparator = document.getElementById('btn-close-comparator') as HTMLButtonElement | null;
const comparatorOverlay  = document.getElementById('comparator-overlay')   as HTMLElement | null;
const comparatorChecks   = document.getElementById('comparator-checkboxes') as HTMLElement | null;
const comparatorGrid     = document.getElementById('comparator-grid')      as HTMLElement | null;

// Max simultaneous comparator engines per tier — each is its own WebGL context.
const TIER_MAX_COMPARATORS: Record<PerformanceTier, number> = { low: 2, medium: 3, high: 4 };

interface ComparatorEntry { engine: PhosphorGrid; }
let comparatorEngines: ComparatorEntry[] = [];
let comparatorRafId: number | null = null;
let selectedPresetIds: string[] = [];

function populateComparatorCheckboxes(): void {
  if (!comparatorChecks) return;
  comparatorChecks.innerHTML = '';
  const maxN = TIER_MAX_COMPARATORS[activeTier];
  PRESETS.forEach(preset => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = preset.id;
    checkbox.checked = selectedPresetIds.includes(preset.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && selectedPresetIds.length >= maxN) {
        checkbox.checked = false;
        alert(`El tier "${activeTier}" permite hasta ${maxN} comparaciones a la vez. Cambia a un tier de rendimiento mayor para más.`);
        return;
      }
      selectedPresetIds = checkbox.checked
        ? [...selectedPresetIds, preset.id]
        : selectedPresetIds.filter(id => id !== preset.id);
      rebuildComparatorCanvases();
    });
    label.appendChild(checkbox);
    label.append(preset.label);
    comparatorChecks.appendChild(label);
  });
}

/** Releases every comparator WebGL context — non-negotiable, contexts are a scarce resource. */
function disposeComparatorEngines(): void {
  comparatorEngines.forEach(entry => entry.engine.dispose());
  comparatorEngines = [];
  if (comparatorGrid) comparatorGrid.innerHTML = '';
}

function rebuildComparatorCanvases(): void {
  if (!comparatorGrid) return;
  // Re-clamp to the current tier every rebuild — covers dropping to a lower
  // tier with more presets already selected than the new tier allows.
  const maxN = TIER_MAX_COMPARATORS[activeTier];
  if (selectedPresetIds.length > maxN) {
    selectedPresetIds = selectedPresetIds.slice(0, maxN);
    populateComparatorCheckboxes();
  }
  disposeComparatorEngines();
  selectedPresetIds.forEach(id => {
    const preset = PRESETS.find(p => p.id === id);
    if (!preset) return;

    const cell = document.createElement('div');
    cell.className = 'comparator-cell';
    const canvas = document.createElement('canvas');
    const label = document.createElement('div');
    label.className = 'comparator-label';
    label.textContent = preset.label;
    cell.appendChild(canvas);
    cell.appendChild(label);
    comparatorGrid.appendChild(cell);

    const miniEngine = new PhosphorGrid({ canvas });
    miniEngine.updateOptions(preset);
    comparatorEngines.push({ engine: miniEngine });
  });
}

function startComparatorLoop(): void {
  if (comparatorRafId !== null) return;
  const tick = () => {
    if (!comparatorOverlay || comparatorOverlay.style.display === 'none') { comparatorRafId = null; return; }
    if (activeSource) {
      for (const comparatorEntry of comparatorEngines) {
        // NOTE: Comparison mode disabled in comparator views to avoid confusion
        if (activeSource instanceof HTMLVideoElement && !isComparing) {
          // For video in comparator, we need to handle the frame pushing
          // But since comparator is for preset comparison, we'll keep it simple
          // and use the current frame without special video handling
          comparatorEntry.engine.render(activeSource, false, currentTime(), 0.0, currentQualityLevel(), 1.0, false);
        } else {
          comparatorEntry.engine.render(activeSource, false, currentTime(), 0.0, currentQualityLevel(), 1.0, false);
        }
      }
    }
    comparatorRafId = requestAnimationFrame(tick);
  };
  comparatorRafId = requestAnimationFrame(tick);
}

function stopComparatorLoop(): void {
  if (comparatorRafId !== null) { cancelAnimationFrame(comparatorRafId); comparatorRafId = null; }
}

btnOpenComparator?.addEventListener('click', () => {
  if (!comparatorOverlay) return;
  comparatorOverlay.style.display = 'flex';
  if (selectedPresetIds.length === 0) {
    selectedPresetIds = PRESETS.slice(0, TIER_MAX_COMPARATORS[activeTier]).map(p => p.id);
  }
  populateComparatorCheckboxes();
  rebuildComparatorCanvases();
  startComparatorLoop();
});

btnCloseComparator?.addEventListener('click', () => {
  if (!comparatorOverlay) return;
  comparatorOverlay.style.display = 'none';
  stopComparatorLoop();
  disposeComparatorEngines();
});

// ── ResizeObserver: re-render on container resize ──────────────
// For video, RVFC is running — the next frame callback will pick up the
// new dimensions automatically. For static images, re-trigger process().
const ro = new ResizeObserver(() => {
  if (activeSource && !activeVideo && !rafId && !isComparing) process();
});
ro.observe(container);

// Initial state setup
if (splitHint) {
  splitHint.style.display = 'block';
  splitHint.textContent = 'drag to compare original vs phosphor · dblclick to reset';
}