/**
 * DOM control binding module.
 * Encapsulates all slider/radio/select interactions and exposes
 * a typed ControlValues getter/setter pair.
 */

export interface ControlValues {
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

type ChangeCallback = (values: ControlValues) => void;

function el<T extends HTMLElement>(id: string): T {
  const elem = document.getElementById(id);
  if (!elem) throw new Error(`Element #${id} not found`);
  return elem as T;
}

/**
 * Binds a range input and its display span.
 * Returns the input element for later value reads.
 */
function bindSlider(
  inputId: string,
  spanId: string,
  format: (v: string) => string,
  onChange: () => void
): HTMLInputElement {
  const input = el<HTMLInputElement>(inputId);
  const span = el<HTMLSpanElement>(spanId);
  span.textContent = format(input.value);
  input.addEventListener('input', () => {
    span.textContent = format(input.value);
    onChange();
  });
  return input;
}

export function bindControls(onChange: ChangeCallback): {
  getValues: () => ControlValues;
  setValues: (values: Partial<ControlValues>) => void;
} {
  const paramWidth      = bindSlider('param-width',       'val-width',       v => `${v}px`,                          notify);
  const paramGap        = bindSlider('param-gap',         'val-gap',         v => `${v}px`,                          notify);
  const paramSharpness  = bindSlider('param-sharpness',   'val-sharpness',   v => parseFloat(v).toFixed(1),          notify);
  const paramBloom      = bindSlider('param-bloom',       'val-bloom',       v => parseFloat(v).toFixed(2),          notify);
  const paramCurvature  = bindSlider('param-curvature',   'val-curvature',   v => parseFloat(v).toFixed(2),          notify);
  const paramVignette   = bindSlider('param-vignette',    'val-vignette',    v => parseFloat(v).toFixed(2),          notify);
  const paramScanlines  = bindSlider('param-scanlines',   'val-scanlines',   v => parseFloat(v).toFixed(2),          notify);
  const paramTemp       = bindSlider('param-temp',        'val-temp',        v => `${v}K`,                           notify);
  const paramSaturation = bindSlider('param-saturation',  'val-saturation',  v => parseFloat(v).toFixed(2),          notify);
  const paramContrast   = bindSlider('param-contrast',    'val-contrast',    v => parseFloat(v).toFixed(2),          notify);
  const paramBrightness = bindSlider('param-brightness',  'val-brightness',  v => parseFloat(v).toFixed(2),          notify);
  const paramLod        = bindSlider('param-lod',         'val-lod',         v => parseFloat(v).toFixed(2),          notify);
  const paramDetailBoost= bindSlider('param-detail-boost','val-detail-boost',v => parseFloat(v).toFixed(2),          notify);
  const paramNoise      = bindSlider('param-noise',       'val-noise',       v => parseFloat(v).toFixed(2),          notify);
  const paramFlicker    = bindSlider('param-flicker',     'val-flicker',     v => parseFloat(v).toFixed(2),          notify);

  const renderGrid      = el<HTMLInputElement>('render-grid');
  const renderClearType = el<HTMLInputElement>('render-cleartype');
  const paramMaskType   = el<HTMLSelectElement>('param-mask-type');

  renderGrid.addEventListener('change', notify);
  renderClearType.addEventListener('change', notify);
  paramMaskType.addEventListener('change', notify);

  function notify(): void {
    onChange(getValues());
  }

  function getValues(): ControlValues {
    return {
      subpixelWidth:  parseInt(paramWidth.value),
      gap:            parseInt(paramGap.value),
      renderingMode:  renderClearType.checked ? 'cleartype' : 'grid',
      sharpness:      parseFloat(paramSharpness.value),
      bloom:          parseFloat(paramBloom.value),
      curvature:      parseFloat(paramCurvature.value),
      vignette:       parseFloat(paramVignette.value),
      scanlines:      parseFloat(paramScanlines.value),
      maskType:       paramMaskType.value as 'aperture' | 'shadow' | 'slot',
      colorTempK:     parseInt(paramTemp.value),
      brightness:     parseFloat(paramBrightness.value),
      contrast:       parseFloat(paramContrast.value),
      saturation:     parseFloat(paramSaturation.value),
      lodBias:        parseFloat(paramLod.value),
      detailBoost:    parseFloat(paramDetailBoost.value),
      noise:          parseFloat(paramNoise.value),
      flicker:        parseFloat(paramFlicker.value),
    };
  }

  function setValues(values: Partial<ControlValues>): void {
    const span = (id: string, text: string) =>
      (document.getElementById(id) as HTMLSpanElement | null)
        && ((document.getElementById(id) as HTMLSpanElement).textContent = text);

    if (values.subpixelWidth !== undefined) {
      paramWidth.value = values.subpixelWidth.toString();
      span('val-width', `${values.subpixelWidth}px`);
    }
    if (values.gap !== undefined) {
      paramGap.value = values.gap.toString();
      span('val-gap', `${values.gap}px`);
    }
    if (values.renderingMode !== undefined) {
      renderGrid.checked = values.renderingMode === 'grid';
      renderClearType.checked = values.renderingMode === 'cleartype';
    }
    if (values.sharpness !== undefined) {
      paramSharpness.value = values.sharpness.toString();
      span('val-sharpness', values.sharpness.toFixed(1));
    }
    if (values.bloom !== undefined) {
      paramBloom.value = values.bloom.toString();
      span('val-bloom', values.bloom.toFixed(2));
    }
    if (values.curvature !== undefined) {
      paramCurvature.value = values.curvature.toString();
      span('val-curvature', values.curvature.toFixed(2));
    }
    if (values.vignette !== undefined) {
      paramVignette.value = values.vignette.toString();
      span('val-vignette', values.vignette.toFixed(2));
    }
    if (values.scanlines !== undefined) {
      paramScanlines.value = values.scanlines.toString();
      span('val-scanlines', values.scanlines.toFixed(2));
    }
    if (values.maskType !== undefined) {
      paramMaskType.value = values.maskType;
    }
    if (values.colorTempK !== undefined) {
      paramTemp.value = values.colorTempK.toString();
      span('val-temp', `${values.colorTempK}K`);
    }
    if (values.brightness !== undefined) {
      paramBrightness.value = values.brightness.toString();
      span('val-brightness', values.brightness.toFixed(2));
    }
    if (values.contrast !== undefined) {
      paramContrast.value = values.contrast.toString();
      span('val-contrast', values.contrast.toFixed(2));
    }
    if (values.saturation !== undefined) {
      paramSaturation.value = values.saturation.toString();
      span('val-saturation', values.saturation.toFixed(2));
    }
    if (values.lodBias !== undefined) {
      paramLod.value = values.lodBias.toString();
      span('val-lod', values.lodBias.toFixed(2));
    }
    if (values.detailBoost !== undefined) {
      paramDetailBoost.value = values.detailBoost.toString();
      span('val-detail-boost', values.detailBoost.toFixed(2));
    }
    if (values.noise !== undefined) {
      paramNoise.value = values.noise.toString();
      span('val-noise', values.noise.toFixed(2));
    }
    if (values.flicker !== undefined) {
      paramFlicker.value = values.flicker.toString();
      span('val-flicker', values.flicker.toFixed(2));
    }
  }

  return { getValues, setValues };
}
