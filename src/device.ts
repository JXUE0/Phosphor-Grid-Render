/**
 * Shared device detection for engine and orchestration layers.
 */

/** True on mobile / lower-end touch devices (UA sniff + coarse-pointer heuristic). */
export const isMobileDevice =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
  (window.matchMedia('(pointer: coarse)').matches && window.devicePixelRatio > 1.5);
