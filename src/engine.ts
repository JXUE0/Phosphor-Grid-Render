/**
 * PhosphorGrid — GPU WebGL phosphor display simulator.
 *
 * Decomposes each source pixel into its physical R, G, B subpixel
 * components (stripes/dots) and applies real display optics:
 * - Proper sRGB gamma encode/decode (IEC 61966-2-1)
 * - Aperture Grille / Shadow Mask / Slot Mask patterns
 * - Cosine-shaped phosphor glow + inter-channel bloom
 * - Analog noise, flicker, vignette, scanlines
 * - Split-view comparison (original ↔ phosphor)
 */

import { isMobileDevice } from './device';

export interface PhosphorGridOptions {
  canvas: HTMLCanvasElement;
  subpixelWidth?: number;           // Physical subpixel width in screen pixels
  gap?: number;                     // Gap between subpixel triads
  renderingMode?: 'grid' | 'cleartype';
  sharpness?: number;               // Cosine phosphor falloff exponent
  bloom?: number;                   // Inter-channel beam bleed
  curvature?: number;               // CRT barrel distortion (0 = flat)
  vignette?: number;                // Corner darkening
  scanlines?: number;               // Horizontal scanline overlay
  maskType?: 'aperture' | 'shadow' | 'slot' | 'lcd';
  colorTemp?: [number, number, number]; // [R, G, B] multipliers (from Kelvin)
  brightness?: number;              // Black level offset
  contrast?: number;                // Contrast scaling
  saturation?: number;              // Color saturation
  lodBias?: number;                 // Texture LOD bias (negative = sharper)
  detailBoost?: number;             // High-frequency highlight emphasis
  noise?: number;                   // Film grain / analog noise (0–1)
  flicker?: number;                 // Phosphor persistence flicker (0–1)
  outputColorspace?: 'srgb' | 'linear' | 'hdr'; // Output gamma / tone mapping
}

// Cached shader resource locations (populated once at init, never per-frame)
type UniformCache = { [name: string]: WebGLUniformLocation | null };

export class PhosphorGrid {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private isWebGL2 = false;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private buffer: WebGLBuffer | null = null;
  private maxTexSize = 4096;

  // ── Temporal interpolation (phosphor persistence) ──
  // texturePrev holds the previous video frame; pushVideoFrame() swaps the two
  // textures and uploads the new frame, so both are always resident. The blend
  // happens in the preprocessing pass (never in the main phosphor shader).
  private texturePrev: WebGLTexture | null = null;
  private prevTexW = 0;
  private prevTexH = 0;
  private hasPrevFrame = false;   // prev texture holds a valid same-size frame
  private videoFrameMode = false; // frames arrive via pushVideoFrame(), render() must not re-upload
  private lastPushedVideo: HTMLVideoElement | null = null;

  // ── Preprocessing pass (temporal blend + FSR-style source upscale) ──
  // Renders source → prepTexture at output resolution before the phosphor
  // shader samples it. Bypassed entirely when neither feature is active.
  private prepProgram: WebGLProgram | null = null;
  private prepAttribPosition = -1;
  private prepUniforms: UniformCache = {};
  private prepFBO: WebGLFramebuffer | null = null;
  private prepTexture: WebGLTexture | null = null;
  private prepW = 0;
  private prepH = 0;

  // Cached locations — set once in initWebGL(), used every render()
  private attribPosition = -1;
  private uniforms: UniformCache = {};

  // texSubImage2D optimization: skip GPU realloc when dimensions are unchanged
  private lastTexW = 0;
  private lastTexH = 0;

  // Video frames are pre-drawn onto this offscreen 2D canvas before being
  // uploaded as a texture — some browsers leak a stray chroma-subsampling
  // fringe at the frame edge when a <video> element is fed directly into
  // texImage2D/texSubImage2D (a known artifact of certain hardware decode
  // paths). drawImage() goes through the browser's normal, already-correct
  // video compositing path, which doesn't have that problem.
  private videoCanvas: HTMLCanvasElement | null = null;
  private videoCtx: CanvasRenderingContext2D | null = null;

  // GPU timer query (EXT_disjoint_timer_query[_webgl2]) — feature-detected,
  // silently unavailable on browsers/GPUs without support (notably most mobile/Safari).
  private timerExt: any = null;
  private pendingQuery: WebGLQuery | null = null;
  private queryActiveThisFrame = false; // true only when THIS render() actually began a query
  private lastGPUTimeMs: number | null = null;

  // Engine state
  private subpixelWidth: number;
  private gap: number;
  private renderingMode: 'grid' | 'cleartype';
  private sharpness: number;
  private bloom: number;
  private curvature: number;
  private vignette: number;
  private scanlines: number;
  private maskType: 'aperture' | 'shadow' | 'slot' | 'lcd';
  private colorTemp: [number, number, number];
  private brightness: number;
  private contrast: number;
  private saturation: number;
  private lodBias: number;
  private detailBoost: number;
  private noise: number;
  private flicker: number;
  private outputColorspace: 'srgb' | 'linear' | 'hdr';

  constructor(options: PhosphorGridOptions) {
    this.canvas = options.canvas;

    // Prefer WebGL 2 for native NPOT mipmap support
    let gl: WebGL2RenderingContext | WebGLRenderingContext | null =
      this.canvas.getContext('webgl2', { preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (gl) {
      this.isWebGL2 = true;
    } else {
      gl = (
        this.canvas.getContext('webgl', { preserveDrawingBuffer: false }) ||
        this.canvas.getContext('experimental-webgl', { preserveDrawingBuffer: false })
      ) as WebGLRenderingContext | null;
    }
    if (!gl) throw new Error('WebGL not supported in this browser.');
    this.gl = gl;
    this.maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    // Defaults mirror the initial control values in index.html — these are
    // what a freshly loaded source renders with before any control is touched.
    this.subpixelWidth  = options.subpixelWidth  ?? 1;
    this.gap            = options.gap            ?? 0;
    this.renderingMode  = options.renderingMode  ?? 'grid';
    this.sharpness      = options.sharpness      ?? 1.0;
    this.bloom          = options.bloom          ?? 1.0;
    this.curvature      = options.curvature      ?? 0.0;
    this.vignette       = options.vignette       ?? 0.0;
    this.scanlines      = options.scanlines      ?? 0.0;
    this.maskType       = options.maskType       ?? 'aperture';
    this.colorTemp      = options.colorTemp      ?? [1.0, 0.9965101328455601, 0.9805565033048651];
    this.brightness     = options.brightness     ?? -0.05;
    this.contrast       = options.contrast       ?? 1.0;
    this.saturation     = options.saturation     ?? 1.0;
    this.lodBias        = options.lodBias        ?? -0.6;
    this.detailBoost    = options.detailBoost    ?? 0.3;
    this.noise             = options.noise             ?? 0.0;
    this.flicker           = options.flicker           ?? 0.1;
    this.outputColorspace  = options.outputColorspace  ?? 'srgb';

    this.initWebGL();
  }

  // ─────────────────────────────────────────────
  // WebGL Initialization
  // ─────────────────────────────────────────────

  private initWebGL(): void {
    const gl = this.gl;

    // Vertex shader: covers the full viewport with a clip-space quad
    const vsSource = `
      attribute vec2 position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    // Fragment shader: full phosphor display simulation
    const fsSource = `
      precision mediump float;
      varying vec2 v_texCoord;

      // ── Uniforms ──────────────────────────────────
      uniform sampler2D u_texture;
      uniform float u_subpixel_width;
      uniform float u_gap;
      uniform float u_rendering_mode;   // 0 = Physical Grid, 1 = ClearType
      uniform float u_sharpness;
      uniform float u_bloom;
      uniform float u_curvature;
      uniform float u_vignette;
      uniform float u_scanlines;
      uniform float u_mask_type;        // 0 = Aperture, 1 = Shadow, 2 = Slot, 3 = LCD
      uniform float u_quality_level;    // 0 = Low, 1 = Medium, 2 = High — gates cosmetic-only passes
      uniform vec3  u_color_temp;
      uniform float u_brightness;
      uniform float u_contrast;
      uniform float u_saturation;
      uniform float u_lod_bias;
      uniform float u_detail_boost;
      uniform vec2  u_canvas_resolution;
      uniform float u_noise;
      uniform float u_flicker;
      uniform float u_time;
      uniform float u_split_x;         // 0 = full phosphor, >0 = split (left=original)
      uniform float u_output_space;    // 0 = sRGB, 1 = Linear, 2 = HDR (Reinhard)

      // ── Proper IEC 61966-2-1 sRGB transfer functions ──

      // sRGB → linear light (gamma expand)
      vec3 srgbDecode(vec3 c) {
        c = clamp(c, 0.0, 1.0);
        vec3 lo = c / 12.92;
        vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
        return mix(lo, hi, step(vec3(0.04045), c));
      }

      // linear light → sRGB (gamma compress)
      vec3 srgbEncode(vec3 c) {
        c = clamp(c, 0.0, 1.0);
        vec3 lo = c * 12.92;
        vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
        return mix(lo, hi, step(vec3(0.0031308), c));
      }

      // ── CRT barrel distortion ──
      vec2 curve(vec2 uv, float d) {
        if (d == 0.0) return uv;
        uv = (uv - 0.5) * 2.0;
        uv.x *= 1.0 + uv.y * uv.y * d * 0.15;
        uv.y *= 1.0 + uv.x * uv.x * d * 0.20;
        return uv * 0.5 + 0.5;
      }

      // ── Color grading (linear space) ──
      vec3 adjustColor(vec3 c, float brightness, float contrast, float saturation) {
        c = (c - 0.5) * contrast + 0.5 + brightness;
        c = clamp(c, 0.0, 1.0);
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        return clamp(mix(vec3(luma), c, saturation), 0.0, 1.0);
      }

      // ── High-frequency detail boost (stars/sparks) ──
      vec3 sampleAndBoost(vec2 uv) {
        vec3 sharp = texture2D(u_texture, uv, u_lod_bias).rgb;
        // The soft second sample is a cosmetic-only pass — skip it below Medium quality.
        if (u_detail_boost > 0.0 && u_quality_level > 0.5) {
          vec3 soft = texture2D(u_texture, uv, u_lod_bias + 2.5).rgb;
          float sl = dot(sharp, vec3(0.2126, 0.7152, 0.0722));
          float bl = dot(soft,  vec3(0.2126, 0.7152, 0.0722));
          if (sl > bl + 0.005) {
            sharp = clamp(sharp + sharp * (sl - bl) * u_detail_boost * 2.0, 0.0, 1.0);
          }
        }
        return sharp;
      }

      // ── Pseudo-random hash (texel-stable, no texture lookup) ──
      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      // ── Main ──────────────────────────────────────
      void main() {
        // 1. CRT barrel distortion
        vec2 uv = curve(v_texCoord, u_curvature);

        // Black border outside the curved screen boundary
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }

        // 2. Split-view: pixels left of u_split_x show the original image
        if (u_split_x > 0.0) {
          // Standard width is 1.5 pixels. Antialiased split line:
          float center_x = u_split_x * u_canvas_resolution.x;
          float dist = abs(gl_FragCoord.x - center_x);
          
          if (dist < 1.5) {
            // Smooth edge blending for the divider line
            float edge = smoothstep(1.5, 0.5, dist);
            // Amber Core brand color (#f59e0b) = vec3(0.96, 0.62, 0.04)
            vec3 divider_color = vec3(0.96, 0.62, 0.04);
            
            // Sample source to blend behind the divider
            vec3 back_color = (gl_FragCoord.x < center_x) 
              ? texture2D(u_texture, uv).rgb 
              : srgbEncode(srgbDecode(adjustColor(texture2D(u_texture, uv).rgb * u_color_temp, u_brightness, u_contrast, u_saturation)));
            
            gl_FragColor = vec4(mix(back_color, divider_color, edge), 1.0);
            return;
          }
          if (uv.x < u_split_x) {
            gl_FragColor = vec4(texture2D(u_texture, uv).rgb, 1.0);
            return;
          }
        }

        // 3. Sample source → linear light
        vec3 linear_color;
        if (u_rendering_mode > 0.5) {
          // ClearType mode: spatially offset R/G/B by 1/3 subpixel
          float pw = 1.0 / u_canvas_resolution.x;
          vec3 rs = adjustColor(sampleAndBoost(uv - vec2(pw / 3.0, 0.0)), u_brightness, u_contrast, u_saturation);
          vec3 gs = adjustColor(sampleAndBoost(uv),                         u_brightness, u_contrast, u_saturation);
          vec3 bs = adjustColor(sampleAndBoost(uv + vec2(pw / 3.0, 0.0)), u_brightness, u_contrast, u_saturation);
          linear_color = vec3(
            srgbDecode(rs * u_color_temp).r,
            srgbDecode(gs * u_color_temp).g,
            srgbDecode(bs * u_color_temp).b
          );
        } else {
          // Physical Grid mode: single sample per fragment
          vec3 adjusted = adjustColor(sampleAndBoost(uv), u_brightness, u_contrast, u_saturation);
          linear_color = srgbDecode(adjusted * u_color_temp);
        }

        // 4. Physical phosphor mask (screen-space coordinates)
        vec2 px = floor(gl_FragCoord.xy);

        float sw      = u_subpixel_width;
        float macro_w = sw * 3.0 + u_gap * 3.0;   // Total triad width (lit + dark)
        float macro_h = sw * 3.0 + u_gap;           // Total triad height

        // LCD (3): flat rectangular subpixels, no phosphor glow — distinct branch
        // from the CRT masks (0-2), which all share the cosine falloff below.
        bool isLCD = u_mask_type > 2.5;

        // Horizontal stagger per mask type (LCD and Aperture: no stagger)
        float x_off = 0.0;
        if (u_mask_type > 1.5 && u_mask_type < 2.5) {
          // Slot Mask: alternating half-period stagger every 2 rows
          x_off = mod(floor(px.y / (macro_h * 2.0)), 2.0) * (macro_w * 0.5);
        } else if (u_mask_type > 0.5 && u_mask_type < 1.5) {
          // Shadow Mask: alternating half-period stagger every row
          x_off = mod(floor(px.y / macro_h), 2.0) * (macro_w * 0.5);
        }

        float lx = mod(px.x + x_off, macro_w);
        float ly = mod(px.y,          macro_h);

        // Luma compensation: counter the mask's overall brightness reduction
        float active_w  = sw * 3.0;
        float luma_boost = 3.0 * macro_w / max(active_w, 1.0);

        // Vertical weight: smooth gap or scanline boundary (CRT) vs.
        // hard rectangular gutter (LCD — subpixels don't bloom into the gap)
        float vert_w = 1.0;
        if (isLCD) {
          if (u_gap > 0.0) vert_w = step(ly, active_w);
        } else if (u_gap > 0.0 || u_mask_type > 0.5) {
          float v_phase = (ly / macro_h) * 6.283185;
          vert_w = pow(cos(v_phase) * 0.5 + 0.5, u_sharpness);
        }

        float rw, gw, bw;
        if (isLCD) {
          // Hard-edged rectangular subpixel boxes — real LCD/OLED panels have
          // crisp cell boundaries, not a phosphor cosine falloff.
          float cellW   = max(sw + u_gap, 0.0001);
          float cellIdx = floor(lx / cellW);
          float active  = step(mod(lx, cellW), sw);
          rw = active * step(abs(cellIdx - 0.0), 0.5);
          gw = active * step(abs(cellIdx - 1.0), 0.5);
          bw = active * step(abs(cellIdx - 2.0), 0.5);
        } else {
          // Horizontal cosine-shaped phosphor stripe weights (R / G / B)
          float pi2 = 6.283185;
          rw = pow(cos((lx              / macro_w) * pi2) * 0.5 + 0.5, u_sharpness);
          gw = pow(cos(((lx - macro_w / 3.0) / macro_w) * pi2) * 0.5 + 0.5, u_sharpness);
          bw = pow(cos(((lx - macro_w * 2.0 / 3.0) / macro_w) * pi2) * 0.5 + 0.5, u_sharpness);
        }

        // Beam bloom: each channel bleeds into its neighbours
        float norm = 1.0 / (1.0 + 2.0 * u_bloom);
        vec3 masked;
        masked.r = linear_color.r * (rw + (gw + bw) * u_bloom) * luma_boost * vert_w * norm;
        masked.g = linear_color.g * (gw + (rw + bw) * u_bloom) * luma_boost * vert_w * norm;
        masked.b = linear_color.b * (bw + (rw + gw) * u_bloom) * luma_boost * vert_w * norm;

        // 5. Vignette (dark corners)
        if (u_vignette > 0.0) {
          float vd = length(uv - 0.5);
          masked *= smoothstep(0.707, 0.707 - u_vignette * 0.707, vd);
        }

        // 6. Horizontal scanlines
        if (u_scanlines > 0.0) {
          float scan = sin(px.y * 3.141593) * 0.5 + 0.5;
          masked *= mix(1.0, scan, u_scanlines);
        }

        // 7. Phosphor flicker (analog persistence variation)
        if (u_flicker > 0.0) {
          float fw = sin(u_time * 94.248 + sin(u_time * 13.7) * 5.0) * 0.5 + 0.5;
          masked *= 1.0 - u_flicker * 0.08 * fw;
        }

        // 8. Output color space transform
        vec3 out_color;
        if (u_output_space < 0.5) {
          // sRGB standard (default) — proper IEC 61966-2-1 encoding
          out_color = srgbEncode(masked);
        } else if (u_output_space < 1.5) {
          // Linear — raw unencoded phosphor energy (useful for analysis)
          out_color = clamp(masked, 0.0, 1.0);
        } else {
          // HDR — Extended Reinhard: expands highlight headroom by +50%,
          // then sRGB-encodes. Gives brighter whites on SDR displays.
          vec3 hdr = masked * 1.5;
          vec3 tm  = hdr * (1.0 + hdr / 4.0) / (1.0 + hdr);
          out_color = srgbEncode(tm);
        }

        // 9. Film grain applied in display domain (after gamma) — cosmetic-only, skip below Medium
        if (u_noise > 0.0 && u_quality_level > 0.5) {
          float t_off = fract(u_time * 23.174);
          float grain = hash21(v_texCoord + vec2(t_off, t_off * 0.7)) - 0.5;
          out_color = clamp(out_color + grain * u_noise * 0.15, 0.0, 1.0);
        }

        gl_FragColor = vec4(out_color, 1.0);
      }
    `;

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    this.program = gl.createProgram();
    if (!this.program) return;

    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('PhosphorGrid shader link error:', gl.getProgramInfoLog(this.program));
      return;
    }

    // Cache attribute location once
    this.attribPosition = gl.getAttribLocation(this.program, 'position');

    // Cache all uniform locations once — never call getUniformLocation per frame
    const uniformNames = [
      'u_subpixel_width', 'u_gap', 'u_rendering_mode', 'u_sharpness',
      'u_bloom', 'u_curvature', 'u_vignette', 'u_scanlines', 'u_mask_type',
      'u_color_temp', 'u_brightness', 'u_contrast', 'u_saturation',
      'u_lod_bias', 'u_detail_boost', 'u_canvas_resolution',
      'u_noise', 'u_flicker', 'u_time', 'u_split_x', 'u_output_space',
      'u_quality_level',
    ];
    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }

    // Full-screen clip-space quad (two triangles)
    const vertices = new Float32Array([-1, -1,  1, -1,  -1, 1,  -1, 1,  1, -1,  1, 1]);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    // Texture: trilinear filtering for clean minification
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Previous-frame texture (temporal interpolation). 1×1 placeholder so the
    // sampler is always complete even before the first video frame arrives.
    // Params identical to the main texture — pushVideoFrame() swaps the two
    // handles every frame, so both alternate between "current" and "previous".
    this.texturePrev = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texturePrev);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

    this.initPrepPass(vsSource);

    // Optional GPU timer extension — null on unsupported browsers (fine, we fall
    // back to CPU-side performance.now() timing wherever this is consumed).
    this.timerExt = this.isWebGL2
      ? gl.getExtension('EXT_disjoint_timer_query_webgl2')
      : gl.getExtension('EXT_disjoint_timer_query');
  }

  /**
   * Compiles the preprocessing program (temporal frame blend + FSR-inspired
   * source upscale) and creates its render target. On failure everything stays
   * null and render() silently bypasses the pass — the core simulation never
   * depends on it.
   */
  private initPrepPass(vsSource: string): void {
    const gl = this.gl;

    const prepFsSource = `
      precision mediump float;
      varying vec2 v_texCoord;

      uniform sampler2D u_curr;      // current video frame / image
      uniform sampler2D u_prev;      // previous video frame
      uniform float u_mix;           // 1 = current only; <1 blends previous in
      uniform vec2  u_src_size;      // source dimensions in texels
      uniform float u_mode;          // 0 = blend passthrough, 1 = upscale + sharpen

      // Temporal blend — the GPU-side half of "phosphor persistence".
      // Uniform branch keeps the second fetch free when interpolation is off.
      vec3 fetchBlend(vec2 uv) {
        vec3 c = texture2D(u_curr, uv).rgb;
        if (u_mix < 0.999) c = mix(texture2D(u_prev, uv).rgb, c, u_mix);
        return c;
      }

      // 9-tap Catmull-Rom (Karis optimization: corner taps folded into the
      // shared bilinear w1+w2 offsets). Edge-preserving upscale — the EASU
      // role in FSR 1.0, using a separable bicubic instead of AMD's kernel.
      vec3 sampleCatmullRom(vec2 uv) {
        vec2 samplePos = uv * u_src_size;
        vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
        vec2 f = samplePos - texPos1;
        vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
        vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
        vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
        vec2 w3 = f * f * (-0.5 + 0.5 * f);
        vec2 w12 = w1 + w2;
        vec2 offset12 = w2 / w12;
        vec2 texPos0  = (texPos1 - 1.0) / u_src_size;
        vec2 texPos3  = (texPos1 + 2.0) / u_src_size;
        vec2 texPos12 = (texPos1 + offset12) / u_src_size;
        vec3 result = vec3(0.0);
        result += fetchBlend(vec2(texPos0.x,  texPos0.y))  * w0.x  * w0.y;
        result += fetchBlend(vec2(texPos12.x, texPos0.y))  * w12.x * w0.y;
        result += fetchBlend(vec2(texPos3.x,  texPos0.y))  * w3.x  * w0.y;
        result += fetchBlend(vec2(texPos0.x,  texPos12.y)) * w0.x  * w12.y;
        result += fetchBlend(vec2(texPos12.x, texPos12.y)) * w12.x * w12.y;
        result += fetchBlend(vec2(texPos3.x,  texPos12.y)) * w3.x  * w12.y;
        result += fetchBlend(vec2(texPos0.x,  texPos3.y))  * w0.x  * w3.y;
        result += fetchBlend(vec2(texPos12.x, texPos3.y))  * w12.x * w3.y;
        result += fetchBlend(vec2(texPos3.x,  texPos3.y))  * w3.x  * w3.y;
        return clamp(result, 0.0, 1.0);
      }

      void main() {
        if (u_mode < 0.5) {
          // Blend-only: temporal interpolation at native source resolution
          gl_FragColor = vec4(fetchBlend(v_texCoord), 1.0);
          return;
        }

        // Upscale + sharpen (the RCAS role in FSR 1.0): unsharp mask clamped
        // to the local neighborhood min/max, which suppresses halo ringing.
        vec3 up = sampleCatmullRom(v_texCoord);
        vec2 px = 1.0 / u_src_size;
        vec3 n = fetchBlend(v_texCoord + vec2(0.0, -px.y));
        vec3 s = fetchBlend(v_texCoord + vec2(0.0,  px.y));
        vec3 e = fetchBlend(v_texCoord + vec2( px.x, 0.0));
        vec3 o = fetchBlend(v_texCoord + vec2(-px.x, 0.0));
        vec3 lo = min(min(n, s), min(e, o));
        vec3 hi = max(max(n, s), max(e, o));
        vec3 sharp = up + (up - (n + s + e + o) * 0.25) * 0.8;
        gl_FragColor = vec4(clamp(sharp, min(lo, up), max(hi, up)), 1.0);
      }
    `;

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, prepFsSource);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('PhosphorGrid prep shader link error:', gl.getProgramInfoLog(program));
      return;
    }

    this.prepAttribPosition = gl.getAttribLocation(program, 'position');
    for (const name of ['u_mix', 'u_src_size', 'u_mode']) {
      this.prepUniforms[name] = gl.getUniformLocation(program, name);
    }
    // Sampler units are fixed for the program's lifetime
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'u_curr'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_prev'), 1);

    // Render target — storage is (re)allocated per frame to the needed size
    this.prepTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.prepTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // WebGL1 can't mipmap NPOT render targets — plain LINEAR there
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.isWebGL2 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    this.prepFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.prepFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.prepTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.prepProgram = program;
  }

  /**
   * Starts a GPU timer query for the upcoming draw call, if supported. Only one
   * query can be in flight at a time — if the previous one hasn't resolved yet
   * (common: query latency often exceeds one frame), this is a no-op, and
   * queryActiveThisFrame stays false so endGPUQuery() knows not to call
   * endQuery() without a matching, still-active beginQuery() on this target.
   */
  private beginGPUQuery(): void {
    this.queryActiveThisFrame = false;
    if (!this.timerExt || this.pendingQuery) return;
    const gl = this.gl;
    if (this.isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      this.pendingQuery = gl2.createQuery();
      if (this.pendingQuery) {
        gl2.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.pendingQuery);
        this.queryActiveThisFrame = true;
      }
    } else {
      this.pendingQuery = this.timerExt.createQueryEXT();
      if (this.pendingQuery) {
        this.timerExt.beginQueryEXT(this.timerExt.TIME_ELAPSED_EXT, this.pendingQuery);
        this.queryActiveThisFrame = true;
      }
    }
  }

  /** Ends the GPU timer query started by beginGPUQuery() — only if this render() actually started one. */
  private endGPUQuery(): void {
    if (!this.queryActiveThisFrame) return;
    this.queryActiveThisFrame = false;
    if (this.isWebGL2) {
      (this.gl as WebGL2RenderingContext).endQuery(this.timerExt.TIME_ELAPSED_EXT);
    } else {
      this.timerExt.endQueryEXT(this.timerExt.TIME_ELAPSED_EXT);
    }
  }

  /** Draws a video frame onto the intermediate 2D canvas (chroma-fringe fix) and returns it. */
  private videoFrameToCanvas(video: HTMLVideoElement, w: number, h: number): HTMLCanvasElement {
    if (!this.videoCanvas) {
      this.videoCanvas = document.createElement('canvas');
      this.videoCtx = this.videoCanvas.getContext('2d');
    }
    if (this.videoCanvas.width !== w || this.videoCanvas.height !== h) {
      this.videoCanvas.width = w;
      this.videoCanvas.height = h;
    }
    this.videoCtx!.drawImage(video, 0, 0, w, h);
    return this.videoCanvas;
  }

  /** Uploads pixels into this.texture, reusing GPU storage when dims are unchanged. */
  private uploadIntoCurrentTexture(uploadSource: TexImageSource, w: number, h: number, generateMipmaps: boolean): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (w === this.lastTexW && h === this.lastTexH) {
      // Same dimensions: texSubImage2D avoids GPU texture reallocation
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, uploadSource);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, uploadSource);
      this.lastTexW = w;
      this.lastTexH = h;
    }
    // Video is uploaded every decoded frame, so avoid rebuilding its full mip chain.
    // The detail-boost path is the only shader feature that needs mip levels.
    const isPOT = Number.isInteger(Math.log2(w)) && Number.isInteger(Math.log2(h));
    if (generateMipmaps && (this.isWebGL2 || isPOT)) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  }

  /**
   * Uploads a decoded video frame, keeping the previous frame resident for
   * temporal interpolation. Call this from a requestVideoFrameCallback (once
   * per decoded frame); render() can then run at display refresh rate with a
   * frameMix < 1 to interpolate between the two frames, without re-uploading.
   */
  public pushVideoFrame(video: HTMLVideoElement): void {
    if (!this.texture || !this.texturePrev) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    // Swap current/previous texture handles along with their tracked dims
    const t = this.texturePrev; this.texturePrev = this.texture; this.texture = t;
    const tw = this.prevTexW; this.prevTexW = this.lastTexW; this.lastTexW = tw;
    const th = this.prevTexH; this.prevTexH = this.lastTexH; this.lastTexH = th;
    // Previous frame is only blendable if it holds a same-size frame
    this.hasPrevFrame = this.prevTexW === w && this.prevTexH === h;

    this.uploadIntoCurrentTexture(this.videoFrameToCanvas(video, w, h), w, h, false);
    this.videoFrameMode = true;
    this.lastPushedVideo = video;
  }

  /** Call when switching to a different source — clears stale push-mode / prev-frame state. */
  public resetVideoFrameState(): void {
    this.videoFrameMode = false;
    this.lastPushedVideo = null;
    this.hasPrevFrame = false;
    this.prevTexW = 0;
    this.prevTexH = 0;
  }

  /**
   * Runs the preprocessing pass: blends texturePrev → texture by `mix` (temporal
   * interpolation) and/or upscales+sharpens the result into prepTexture, sized
   * at the output resolution when upscaling or at source resolution otherwise.
   */
  private runPrepPass(srcW: number, srcH: number, outW: number, outH: number, mix: number, upscale: boolean, generateMipmaps: boolean): void {
    const gl = this.gl;
    if (!this.prepProgram || !this.prepFBO || !this.prepTexture) return;

    const targetW = upscale ? outW : srcW;
    const targetH = upscale ? outH : srcH;
    if (this.prepW !== targetW || this.prepH !== targetH) {
      gl.bindTexture(gl.TEXTURE_2D, this.prepTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetW, targetH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.prepW = targetW;
      this.prepH = targetH;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.prepFBO);
    gl.viewport(0, 0, targetW, targetH);

    gl.useProgram(this.prepProgram);
    gl.enableVertexAttribArray(this.prepAttribPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.vertexAttribPointer(this.prepAttribPosition, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.hasPrevFrame ? this.texturePrev : this.texture);

    gl.uniform1f(this.prepUniforms['u_mix'], this.hasPrevFrame ? mix : 1.0);
    gl.uniform2f(this.prepUniforms['u_src_size'], srcW, srcH);
    gl.uniform1f(this.prepUniforms['u_mode'], upscale ? 1.0 : 0.0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (generateMipmaps && this.isWebGL2) {
      gl.bindTexture(gl.TEXTURE_2D, this.prepTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.prepTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  }

  /** Non-blocking poll of the previous frame's pending query result. */
  private pollGPUQuery(): void {
    if (!this.timerExt || !this.pendingQuery) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
    if (this.isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      const available = gl2.getQueryParameter(this.pendingQuery, gl2.QUERY_RESULT_AVAILABLE);
      if (!available) return;
      if (!disjoint) this.lastGPUTimeMs = (gl2.getQueryParameter(this.pendingQuery, gl2.QUERY_RESULT) as number) / 1e6;
      gl2.deleteQuery(this.pendingQuery);
    } else {
      const ext = this.timerExt;
      const available = ext.getQueryObjectEXT(this.pendingQuery, ext.QUERY_RESULT_AVAILABLE_EXT);
      if (!available) return;
      if (!disjoint) this.lastGPUTimeMs = (ext.getQueryObjectEXT(this.pendingQuery, ext.QUERY_RESULT_EXT) as number) / 1e6;
      ext.deleteQueryEXT(this.pendingQuery);
    }
    this.pendingQuery = null;
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('PhosphorGrid shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  /** Updates engine parameters without re-compiling shaders. */
  public updateOptions(options: Partial<Omit<PhosphorGridOptions, 'canvas'>>): void {
    if (options.subpixelWidth !== undefined) this.subpixelWidth = options.subpixelWidth;
    if (options.gap           !== undefined) this.gap           = options.gap;
    if (options.renderingMode !== undefined) this.renderingMode = options.renderingMode;
    if (options.sharpness     !== undefined) this.sharpness     = options.sharpness;
    if (options.bloom         !== undefined) this.bloom         = options.bloom;
    if (options.curvature     !== undefined) this.curvature     = options.curvature;
    if (options.vignette      !== undefined) this.vignette      = options.vignette;
    if (options.scanlines     !== undefined) this.scanlines     = options.scanlines;
    if (options.maskType      !== undefined) this.maskType      = options.maskType;
    if (options.colorTemp     !== undefined) this.colorTemp     = options.colorTemp;
    if (options.brightness    !== undefined) this.brightness    = options.brightness;
    if (options.contrast      !== undefined) this.contrast      = options.contrast;
    if (options.saturation    !== undefined) this.saturation    = options.saturation;
    if (options.lodBias       !== undefined) this.lodBias       = options.lodBias;
    if (options.detailBoost   !== undefined) this.detailBoost   = options.detailBoost;
    if (options.noise             !== undefined) this.noise            = options.noise;
    if (options.flicker           !== undefined) this.flicker          = options.flicker;
    if (options.outputColorspace  !== undefined) this.outputColorspace = options.outputColorspace;
  }

  /**
   * Renders one frame of the phosphor simulation. Canvas resolution always
   * matches the real display size (dpr) — quality tier never reduces it, so
   * the "original" split-view / comparison reference is never degraded.
   * @param source  Source image or video element
   * @param isInspect  true = render at 1:1 subpixel resolution (no downscale)
   * @param time    Current time in seconds (drives flicker and noise animation)
   * @param splitX  0 = full phosphor render; 0–1 = split at UV position
   * @param qualityLevel  0=Low, 1=Medium, 2=High — gates cosmetic-only shader passes
   * @param frameMix  1 = show current frame only; <1 blends in the previous
   *                  pushVideoFrame() frame (temporal interpolation / "phosphor persistence")
   * @param upscaleSharpen  FSR-style Catmull-Rom upscale + clamped sharpen of the source,
   *                        applied before the phosphor mask
   */
  public render(
    source: HTMLImageElement | HTMLVideoElement,
    isInspect = false,
    time = 0,
    splitX = 0.0,
    qualityLevel = 2,
    frameMix = 1.0,
    upscaleSharpen = false,
  ): void {
    const gl = this.gl;
    if (!this.program || !this.texture) return;
    this.pollGPUQuery();

    const w = source instanceof HTMLImageElement ? source.naturalWidth  : source.videoWidth;
    const h = source instanceof HTMLImageElement ? source.naturalHeight : source.videoHeight;
    if (!w || !h) return;

    // ── Determine canvas output dimensions ──────
    let finalWidth: number;
    let finalHeight: number;

    if (isInspect) {
      // Inspect mode: 1 source pixel → 1 full phosphor triad
      const macroSize = (this.subpixelWidth * 3) + (this.gap * 3);
      finalWidth  = w * macroSize;
      finalHeight = h * macroSize;
      
      // Guard against GPU limits: use the real max texture size, with a
      // conservative cap on mobile (crashes above 4096px are common there).
      const maxSize = Math.min(this.maxTexSize, isMobileDevice ? 4096 : 16384);
      
      if (finalWidth > maxSize || finalHeight > maxSize) {
        const scale = Math.min(maxSize / finalWidth, maxSize / finalHeight);
        finalWidth  = Math.floor(finalWidth  * scale);
        finalHeight = Math.floor(finalHeight * scale);
      }
    } else {
      // Fit-to-viewport mode: letter/pillar box to fill container
      const containerWidth  = this.canvas.parentElement?.clientWidth  || 500;
      const containerHeight = this.canvas.parentElement?.clientHeight || 500;
      const imageAspect     = w / h;
      const containerAspect = containerWidth / containerHeight;
      let displayWidth: number;
      let displayHeight: number;
      if (imageAspect > containerAspect) {
        displayWidth  = containerWidth;
        displayHeight = Math.floor(containerWidth / imageAspect);
      } else {
        displayHeight = containerHeight;
        displayWidth  = Math.floor(containerHeight * imageAspect);
      }
      const dpr  = window.devicePixelRatio || 1;
      finalWidth  = Math.max(1, Math.floor(displayWidth  * dpr));
      finalHeight = Math.max(1, Math.floor(displayHeight * dpr));
    }

    if (this.canvas.width  !== finalWidth)  this.canvas.width  = finalWidth;
    if (this.canvas.height !== finalHeight) this.canvas.height = finalHeight;

    // ── Upload source pixels to GPU texture ──────
    // Skipped when the caller already fed this exact frame via pushVideoFrame()
    // (the smooth-interpolation path — render() just re-samples what's resident).
    const skipUpload = source instanceof HTMLVideoElement && this.videoFrameMode && this.lastPushedVideo === source;
    const generateMipmaps = source instanceof HTMLImageElement && qualityLevel > 0 && this.detailBoost > 0;
    if (!skipUpload) {
      const uploadSource: TexImageSource =
        source instanceof HTMLVideoElement ? this.videoFrameToCanvas(source, w, h) : source;
      this.uploadIntoCurrentTexture(uploadSource, w, h, generateMipmaps);
    }

    // ── Optional preprocessing: temporal blend + FSR-style upscale ──
    // Only costs anything when actually requested — otherwise the main shader
    // samples the uploaded texture directly, exactly as before this feature.
    const usePrepPass = !!(this.prepProgram && this.prepFBO) && (frameMix < 0.999 || upscaleSharpen);
    if (usePrepPass) {
      this.runPrepPass(w, h, finalWidth, finalHeight, frameMix, upscaleSharpen, generateMipmaps);
    }

    gl.viewport(0, 0, finalWidth, finalHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // ── Execute shader pipeline ──────────────────
    gl.useProgram(this.program);
    gl.enableVertexAttribArray(this.attribPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.vertexAttribPointer(this.attribPosition, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, usePrepPass ? this.prepTexture : this.texture);

    const u = this.uniforms;
    const pxScale = isInspect ? 1.0 : (window.devicePixelRatio || 1);

    let maskVal = 0.0;
    if (this.maskType === 'shadow') maskVal = 1.0;
    if (this.maskType === 'slot')   maskVal = 2.0;
    if (this.maskType === 'lcd')    maskVal = 3.0;

    gl.uniform1f(u['u_subpixel_width'],   this.subpixelWidth * pxScale);
    gl.uniform1f(u['u_gap'],              this.gap           * pxScale);
    gl.uniform1f(u['u_rendering_mode'],   this.renderingMode === 'cleartype' ? 1.0 : 0.0);
    gl.uniform1f(u['u_sharpness'],        this.sharpness);
    gl.uniform1f(u['u_bloom'],            this.bloom);
    gl.uniform1f(u['u_curvature'],        this.curvature);
    gl.uniform1f(u['u_vignette'],         this.vignette);
    gl.uniform1f(u['u_scanlines'],        this.scanlines);
    gl.uniform1f(u['u_mask_type'],        maskVal);
    gl.uniform3fv(u['u_color_temp'],      this.colorTemp);
    gl.uniform1f(u['u_brightness'],       this.brightness);
    gl.uniform1f(u['u_contrast'],         this.contrast);
    gl.uniform1f(u['u_saturation'],       this.saturation);
    gl.uniform1f(u['u_lod_bias'],         this.lodBias);
    gl.uniform1f(u['u_detail_boost'],     this.detailBoost);
    gl.uniform2f(u['u_canvas_resolution'], finalWidth, finalHeight);
    gl.uniform1f(u['u_noise'],            this.noise);
    gl.uniform1f(u['u_flicker'],          this.flicker);
    gl.uniform1f(u['u_time'],             time);
    gl.uniform1f(u['u_split_x'],          splitX);

    let csVal = 0.0;
    if (this.outputColorspace === 'linear') csVal = 1.0;
    if (this.outputColorspace === 'hdr')    csVal = 2.0;
    gl.uniform1f(u['u_output_space'], csVal);
    gl.uniform1f(u['u_quality_level'], qualityLevel);

    // Only profile GPU time at High quality — the query itself has a small cost.
    const timeThisFrame = qualityLevel >= 2;
    if (timeThisFrame) this.beginGPUQuery();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (timeThisFrame) this.endGPUQuery();
  }

  /** Last measured GPU render time in ms, or null if unsupported/unavailable yet. */
  public getGPUTimeMs(): number | null {
    return this.lastGPUTimeMs;
  }

  /** Returns a snapshot of the current engine configuration. */
  public getOptions(): Omit<PhosphorGridOptions, 'canvas'> {
    return {
      subpixelWidth: this.subpixelWidth,
      gap:           this.gap,
      renderingMode: this.renderingMode,
      sharpness:     this.sharpness,
      bloom:         this.bloom,
      curvature:     this.curvature,
      vignette:      this.vignette,
      scanlines:     this.scanlines,
      maskType:      this.maskType,
      colorTemp:     [...this.colorTemp],
      brightness:    this.brightness,
      contrast:      this.contrast,
      saturation:    this.saturation,
      lodBias:       this.lodBias,
      detailBoost:   this.detailBoost,
      noise:           this.noise,
      flicker:         this.flicker,
      outputColorspace: this.outputColorspace,
    };
  }

  /** True once texture uploads use texSubImage2D (source dimensions stable). */
  public isUsingSubImage(): boolean {
    return this.lastTexW > 0;
  }

  /** Releases all GPU resources. Call when the engine is no longer needed. */
  public dispose(): void {
    const gl = this.gl;
    if (this.program) { gl.deleteProgram(this.program);   this.program = null; }
    if (this.texture) { gl.deleteTexture(this.texture);   this.texture = null; }
    if (this.texturePrev) { gl.deleteTexture(this.texturePrev); this.texturePrev = null; }
    if (this.buffer)  { gl.deleteBuffer(this.buffer);     this.buffer  = null; }
    if (this.prepProgram) { gl.deleteProgram(this.prepProgram); this.prepProgram = null; }
    if (this.prepTexture) { gl.deleteTexture(this.prepTexture); this.prepTexture = null; }
    if (this.prepFBO) { gl.deleteFramebuffer(this.prepFBO); this.prepFBO = null; }
    this.uniforms = {};
    this.prepUniforms = {};
    this.videoCanvas = null;
    this.videoCtx = null;
  }
}
