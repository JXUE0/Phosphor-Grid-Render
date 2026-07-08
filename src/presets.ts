/**
 * Authentic CRT/LCD monitor presets for PhosphorGrid.
 * Each preset captures the characteristic subpixel structure, color response,
 * and analog artifacts of a specific real-world display technology.
 */

export interface Preset {
  id: string;
  label: string;
  description: string;
  subpixelWidth: number;
  gap: number;
  renderingMode: 'grid' | 'cleartype';
  sharpness: number;
  bloom: number;
  curvature: number;
  vignette: number;
  scanlines: number;
  maskType: 'aperture' | 'shadow' | 'slot';
  colorTempK: number;
  brightness: number;
  contrast: number;
  saturation: number;
  lodBias: number;
  detailBoost: number;
  noise: number;
  flicker: number;
}

export const PRESETS: Preset[] = [
  {
    id: 'trinitron',
    label: 'Sony Trinitron',
    description: 'Aperture Grille CRT — Warm, saturated, iconic vertical stripes',
    subpixelWidth: 2,
    gap: 0,
    renderingMode: 'grid',
    sharpness: 2.0,
    bloom: 0.35,
    curvature: 0.08,
    vignette: 0.25,
    scanlines: 0.0,
    maskType: 'aperture',
    colorTempK: 6800,
    brightness: -0.05,
    contrast: 1.1,
    saturation: 1.2,
    lodBias: -1.5,
    detailBoost: 0.5,
    noise: 0.05,
    flicker: 0.1,
  },
  {
    id: 'pvm',
    label: 'PVM Monitor',
    description: 'Professional broadcast CRT — Ultra-sharp, cool white, shadow mask',
    subpixelWidth: 1,
    gap: 1,
    renderingMode: 'grid',
    sharpness: 3.0,
    bloom: 0.1,
    curvature: 0.04,
    vignette: 0.15,
    scanlines: 0.3,
    maskType: 'shadow',
    colorTempK: 9300,
    brightness: -0.08,
    contrast: 1.2,
    saturation: 0.9,
    lodBias: -2.0,
    detailBoost: 1.0,
    noise: 0.02,
    flicker: 0.05,
  },
  {
    id: 'gameboy',
    label: 'Game Boy DMG',
    description: 'Reflective LCD — No backlight, muted palette, strong grid',
    subpixelWidth: 3,
    gap: 1,
    renderingMode: 'grid',
    sharpness: 2.5,
    bloom: 0.05,
    curvature: 0.0,
    vignette: 0.0,
    scanlines: 0.2,
    maskType: 'aperture',
    colorTempK: 5500,
    brightness: -0.1,
    contrast: 1.3,
    saturation: 0.35,
    lodBias: -1.0,
    detailBoost: 0.0,
    noise: 0.0,
    flicker: 0.0,
  },
  {
    id: 'vga',
    label: 'VGA Sharp',
    description: 'ClearType subpixel rendering — Ultra crisp, no CRT artifacts',
    subpixelWidth: 2,
    gap: 0,
    renderingMode: 'cleartype',
    sharpness: 1.5,
    bloom: 0.05,
    curvature: 0.0,
    vignette: 0.0,
    scanlines: 0.0,
    maskType: 'aperture',
    colorTempK: 6500,
    brightness: 0.0,
    contrast: 1.0,
    saturation: 1.0,
    lodBias: -1.5,
    detailBoost: 0.5,
    noise: 0.0,
    flicker: 0.0,
  },
  {
    id: 'arcade',
    label: 'Arcade CRT',
    description: 'Cabinet monitor — Heavy curvature, slot mask, vibrant glow',
    subpixelWidth: 2,
    gap: 1,
    renderingMode: 'grid',
    sharpness: 1.5,
    bloom: 0.5,
    curvature: 0.25,
    vignette: 0.5,
    scanlines: 0.15,
    maskType: 'slot',
    colorTempK: 7500,
    brightness: -0.03,
    contrast: 1.15,
    saturation: 1.3,
    lodBias: -0.5,
    detailBoost: 1.5,
    noise: 0.08,
    flicker: 0.2,
  },
  {
    id: 'oled',
    label: 'OLED Pixel',
    description: 'Modern OLED panel — Perfect blacks, razor-sharp subpixels',
    subpixelWidth: 3,
    gap: 1,
    renderingMode: 'grid',
    sharpness: 4.0,
    bloom: 0.0,
    curvature: 0.0,
    vignette: 0.0,
    scanlines: 0.0,
    maskType: 'aperture',
    colorTempK: 6500,
    brightness: 0.0,
    contrast: 1.0,
    saturation: 1.1,
    lodBias: -2.0,
    detailBoost: 2.0,
    noise: 0.0,
    flicker: 0.0,
  },
];
