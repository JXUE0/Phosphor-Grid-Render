var Tt=Object.defineProperty;var yt=(r,e,t)=>e in r?Tt(r,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):r[e]=t;var c=(r,e,t)=>yt(r,typeof e!="symbol"?e+"":e,t);(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))i(o);new MutationObserver(o=>{for(const n of o)if(n.type==="childList")for(const a of n.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&i(a)}).observe(document,{childList:!0,subtree:!0});function t(o){const n={};return o.integrity&&(n.integrity=o.integrity),o.referrerPolicy&&(n.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?n.credentials="include":o.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function i(o){if(o.ep)return;o.ep=!0;const n=t(o);fetch(o.href,n)}})();const dt=/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)||window.matchMedia("(pointer: coarse)").matches&&window.devicePixelRatio>1.5;class pt{constructor(e){c(this,"canvas");c(this,"gl");c(this,"isWebGL2",!1);c(this,"program",null);c(this,"texture",null);c(this,"buffer",null);c(this,"maxTexSize",4096);c(this,"texturePrev",null);c(this,"prevTexW",0);c(this,"prevTexH",0);c(this,"hasPrevFrame",!1);c(this,"videoFrameMode",!1);c(this,"lastPushedVideo",null);c(this,"prepProgram",null);c(this,"prepAttribPosition",-1);c(this,"prepUniforms",{});c(this,"prepFBO",null);c(this,"prepTexture",null);c(this,"prepW",0);c(this,"prepH",0);c(this,"attribPosition",-1);c(this,"uniforms",{});c(this,"lastTexW",0);c(this,"lastTexH",0);c(this,"videoCanvas",null);c(this,"videoCtx",null);c(this,"timerExt",null);c(this,"pendingQuery",null);c(this,"queryActiveThisFrame",!1);c(this,"lastGPUTimeMs",null);c(this,"subpixelWidth");c(this,"gap");c(this,"renderingMode");c(this,"sharpness");c(this,"bloom");c(this,"curvature");c(this,"vignette");c(this,"scanlines");c(this,"maskType");c(this,"colorTemp");c(this,"brightness");c(this,"contrast");c(this,"saturation");c(this,"lodBias");c(this,"detailBoost");c(this,"noise");c(this,"flicker");c(this,"outputColorspace");this.canvas=e.canvas;let t=this.canvas.getContext("webgl2",{preserveDrawingBuffer:!0});if(t?this.isWebGL2=!0:t=this.canvas.getContext("webgl",{preserveDrawingBuffer:!0})||this.canvas.getContext("experimental-webgl",{preserveDrawingBuffer:!0}),!t)throw new Error("WebGL not supported in this browser.");this.gl=t,this.maxTexSize=t.getParameter(t.MAX_TEXTURE_SIZE),this.subpixelWidth=e.subpixelWidth??1,this.gap=e.gap??0,this.renderingMode=e.renderingMode??"grid",this.sharpness=e.sharpness??1,this.bloom=e.bloom??1,this.curvature=e.curvature??0,this.vignette=e.vignette??0,this.scanlines=e.scanlines??0,this.maskType=e.maskType??"aperture",this.colorTemp=e.colorTemp??[1,.9965101328455601,.9805565033048651],this.brightness=e.brightness??-.05,this.contrast=e.contrast??1,this.saturation=e.saturation??1,this.lodBias=e.lodBias??-.6,this.detailBoost=e.detailBoost??.3,this.noise=e.noise??0,this.flicker=e.flicker??.1,this.outputColorspace=e.outputColorspace??"srgb",this.initWebGL()}initWebGL(){const e=this.gl,t=`
      attribute vec2 position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `,i=`
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
    `,o=this.compileShader(e.VERTEX_SHADER,t),n=this.compileShader(e.FRAGMENT_SHADER,i);if(!o||!n||(this.program=e.createProgram(),!this.program))return;if(e.attachShader(this.program,o),e.attachShader(this.program,n),e.linkProgram(this.program),!e.getProgramParameter(this.program,e.LINK_STATUS)){console.error("PhosphorGrid shader link error:",e.getProgramInfoLog(this.program));return}this.attribPosition=e.getAttribLocation(this.program,"position");const a=["u_subpixel_width","u_gap","u_rendering_mode","u_sharpness","u_bloom","u_curvature","u_vignette","u_scanlines","u_mask_type","u_color_temp","u_brightness","u_contrast","u_saturation","u_lod_bias","u_detail_boost","u_canvas_resolution","u_noise","u_flicker","u_time","u_split_x","u_output_space","u_quality_level"];for(const l of a)this.uniforms[l]=e.getUniformLocation(this.program,l);const u=new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]);this.buffer=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.buffer),e.bufferData(e.ARRAY_BUFFER,u,e.STATIC_DRAW),this.texture=e.createTexture(),e.bindTexture(e.TEXTURE_2D,this.texture),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!0),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),this.texturePrev=e.createTexture(),e.bindTexture(e.TEXTURE_2D,this.texturePrev),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array([0,0,0,255])),this.initPrepPass(t),this.timerExt=this.isWebGL2?e.getExtension("EXT_disjoint_timer_query_webgl2"):e.getExtension("EXT_disjoint_timer_query")}initPrepPass(e){const t=this.gl,i=`
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
    `,o=this.compileShader(t.VERTEX_SHADER,e),n=this.compileShader(t.FRAGMENT_SHADER,i);if(!o||!n)return;const a=t.createProgram();if(a){if(t.attachShader(a,o),t.attachShader(a,n),t.linkProgram(a),!t.getProgramParameter(a,t.LINK_STATUS)){console.error("PhosphorGrid prep shader link error:",t.getProgramInfoLog(a));return}this.prepAttribPosition=t.getAttribLocation(a,"position");for(const u of["u_mix","u_src_size","u_mode"])this.prepUniforms[u]=t.getUniformLocation(a,u);t.useProgram(a),t.uniform1i(t.getUniformLocation(a,"u_curr"),0),t.uniform1i(t.getUniformLocation(a,"u_prev"),1),this.prepTexture=t.createTexture(),t.bindTexture(t.TEXTURE_2D,this.prepTexture),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,this.isWebGL2?t.LINEAR_MIPMAP_LINEAR:t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,null),this.prepFBO=t.createFramebuffer(),t.bindFramebuffer(t.FRAMEBUFFER,this.prepFBO),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,this.prepTexture,0),t.bindFramebuffer(t.FRAMEBUFFER,null),this.prepProgram=a}}beginGPUQuery(){if(this.queryActiveThisFrame=!1,!this.timerExt||this.pendingQuery)return;const e=this.gl;if(this.isWebGL2){const t=e;this.pendingQuery=t.createQuery(),this.pendingQuery&&(t.beginQuery(this.timerExt.TIME_ELAPSED_EXT,this.pendingQuery),this.queryActiveThisFrame=!0)}else this.pendingQuery=this.timerExt.createQueryEXT(),this.pendingQuery&&(this.timerExt.beginQueryEXT(this.timerExt.TIME_ELAPSED_EXT,this.pendingQuery),this.queryActiveThisFrame=!0)}endGPUQuery(){this.queryActiveThisFrame&&(this.queryActiveThisFrame=!1,this.isWebGL2?this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT):this.timerExt.endQueryEXT(this.timerExt.TIME_ELAPSED_EXT))}videoFrameToCanvas(e,t,i){return this.videoCanvas||(this.videoCanvas=document.createElement("canvas"),this.videoCtx=this.videoCanvas.getContext("2d")),(this.videoCanvas.width!==t||this.videoCanvas.height!==i)&&(this.videoCanvas.width=t,this.videoCanvas.height=i),this.videoCtx.drawImage(e,0,0,t,i),this.videoCanvas}uploadIntoCurrentTexture(e,t,i){const o=this.gl;o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this.texture),t===this.lastTexW&&i===this.lastTexH?o.texSubImage2D(o.TEXTURE_2D,0,0,0,o.RGBA,o.UNSIGNED_BYTE,e):(o.texImage2D(o.TEXTURE_2D,0,o.RGBA,o.RGBA,o.UNSIGNED_BYTE,e),this.lastTexW=t,this.lastTexH=i);const n=Number.isInteger(Math.log2(t))&&Number.isInteger(Math.log2(i));this.isWebGL2||n?o.generateMipmap(o.TEXTURE_2D):o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MIN_FILTER,o.LINEAR)}pushVideoFrame(e){if(!this.texture||!this.texturePrev)return;const t=e.videoWidth,i=e.videoHeight;if(!t||!i)return;const o=this.texturePrev;this.texturePrev=this.texture,this.texture=o;const n=this.prevTexW;this.prevTexW=this.lastTexW,this.lastTexW=n;const a=this.prevTexH;this.prevTexH=this.lastTexH,this.lastTexH=a,this.hasPrevFrame=this.prevTexW===t&&this.prevTexH===i,this.uploadIntoCurrentTexture(this.videoFrameToCanvas(e,t,i),t,i),this.videoFrameMode=!0,this.lastPushedVideo=e}resetVideoFrameState(){this.videoFrameMode=!1,this.lastPushedVideo=null,this.hasPrevFrame=!1,this.prevTexW=0,this.prevTexH=0}runPrepPass(e,t,i,o,n,a){const u=this.gl;if(!this.prepProgram||!this.prepFBO||!this.prepTexture)return;const l=a?i:e,w=a?o:t;(this.prepW!==l||this.prepH!==w)&&(u.bindTexture(u.TEXTURE_2D,this.prepTexture),u.texImage2D(u.TEXTURE_2D,0,u.RGBA,l,w,0,u.RGBA,u.UNSIGNED_BYTE,null),this.prepW=l,this.prepH=w),u.bindFramebuffer(u.FRAMEBUFFER,this.prepFBO),u.viewport(0,0,l,w),u.useProgram(this.prepProgram),u.enableVertexAttribArray(this.prepAttribPosition),u.bindBuffer(u.ARRAY_BUFFER,this.buffer),u.vertexAttribPointer(this.prepAttribPosition,2,u.FLOAT,!1,0,0),u.activeTexture(u.TEXTURE0),u.bindTexture(u.TEXTURE_2D,this.texture),u.activeTexture(u.TEXTURE1),u.bindTexture(u.TEXTURE_2D,this.hasPrevFrame?this.texturePrev:this.texture),u.uniform1f(this.prepUniforms.u_mix,this.hasPrevFrame?n:1),u.uniform2f(this.prepUniforms.u_src_size,e,t),u.uniform1f(this.prepUniforms.u_mode,a?1:0),u.drawArrays(u.TRIANGLES,0,6),this.isWebGL2&&(u.bindTexture(u.TEXTURE_2D,this.prepTexture),u.generateMipmap(u.TEXTURE_2D))}pollGPUQuery(){if(!this.timerExt||!this.pendingQuery)return;const e=this.gl,t=e.getParameter(this.timerExt.GPU_DISJOINT_EXT);if(this.isWebGL2){const i=e;if(!i.getQueryParameter(this.pendingQuery,i.QUERY_RESULT_AVAILABLE))return;t||(this.lastGPUTimeMs=i.getQueryParameter(this.pendingQuery,i.QUERY_RESULT)/1e6),i.deleteQuery(this.pendingQuery)}else{const i=this.timerExt;if(!i.getQueryObjectEXT(this.pendingQuery,i.QUERY_RESULT_AVAILABLE_EXT))return;t||(this.lastGPUTimeMs=i.getQueryObjectEXT(this.pendingQuery,i.QUERY_RESULT_EXT)/1e6),i.deleteQueryEXT(this.pendingQuery)}this.pendingQuery=null}compileShader(e,t){const i=this.gl,o=i.createShader(e);return o?(i.shaderSource(o,t),i.compileShader(o),i.getShaderParameter(o,i.COMPILE_STATUS)?o:(console.error("PhosphorGrid shader compile error:",i.getShaderInfoLog(o)),i.deleteShader(o),null)):null}updateOptions(e){e.subpixelWidth!==void 0&&(this.subpixelWidth=e.subpixelWidth),e.gap!==void 0&&(this.gap=e.gap),e.renderingMode!==void 0&&(this.renderingMode=e.renderingMode),e.sharpness!==void 0&&(this.sharpness=e.sharpness),e.bloom!==void 0&&(this.bloom=e.bloom),e.curvature!==void 0&&(this.curvature=e.curvature),e.vignette!==void 0&&(this.vignette=e.vignette),e.scanlines!==void 0&&(this.scanlines=e.scanlines),e.maskType!==void 0&&(this.maskType=e.maskType),e.colorTemp!==void 0&&(this.colorTemp=e.colorTemp),e.brightness!==void 0&&(this.brightness=e.brightness),e.contrast!==void 0&&(this.contrast=e.contrast),e.saturation!==void 0&&(this.saturation=e.saturation),e.lodBias!==void 0&&(this.lodBias=e.lodBias),e.detailBoost!==void 0&&(this.detailBoost=e.detailBoost),e.noise!==void 0&&(this.noise=e.noise),e.flicker!==void 0&&(this.flicker=e.flicker),e.outputColorspace!==void 0&&(this.outputColorspace=e.outputColorspace)}render(e,t=!1,i=0,o=0,n=2,a=1,u=!1){var se,me;const l=this.gl;if(!this.program||!this.texture)return;this.pollGPUQuery();const w=e instanceof HTMLImageElement?e.naturalWidth:e.videoWidth,S=e instanceof HTMLImageElement?e.naturalHeight:e.videoHeight;if(!w||!S)return;let P,C;if(t){const s=this.subpixelWidth*3+this.gap*3;P=w*s,C=S*s;const g=Math.min(this.maxTexSize,dt?4096:16384);if(P>g||C>g){const U=Math.min(g/P,g/C);P=Math.floor(P*U),C=Math.floor(C*U)}}else{const s=((se=this.canvas.parentElement)==null?void 0:se.clientWidth)||500,g=((me=this.canvas.parentElement)==null?void 0:me.clientHeight)||500,U=w/S,Me=s/g;let Ie,Se;U>Me?(Ie=s,Se=Math.floor(s/U)):(Se=g,Ie=Math.floor(g*U));const tt=window.devicePixelRatio||1;P=Math.max(1,Math.floor(Ie*tt)),C=Math.max(1,Math.floor(Se*tt))}if(this.canvas.width!==P&&(this.canvas.width=P),this.canvas.height!==C&&(this.canvas.height=C),!(e instanceof HTMLVideoElement&&this.videoFrameMode&&this.lastPushedVideo===e)){const s=e instanceof HTMLVideoElement?this.videoFrameToCanvas(e,w,S):e;this.uploadIntoCurrentTexture(s,w,S)}const ie=!!(this.prepProgram&&this.prepFBO)&&(a<.999||u);ie&&this.runPrepPass(w,S,P,C,a,u),l.viewport(0,0,P,C),l.bindFramebuffer(l.FRAMEBUFFER,null),l.useProgram(this.program),l.enableVertexAttribArray(this.attribPosition),l.bindBuffer(l.ARRAY_BUFFER,this.buffer),l.vertexAttribPointer(this.attribPosition,2,l.FLOAT,!1,0,0),l.activeTexture(l.TEXTURE0),l.bindTexture(l.TEXTURE_2D,ie?this.prepTexture:this.texture);const f=this.uniforms,oe=t?1:window.devicePixelRatio||1;let X=0;this.maskType==="shadow"&&(X=1),this.maskType==="slot"&&(X=2),this.maskType==="lcd"&&(X=3),l.uniform1f(f.u_subpixel_width,this.subpixelWidth*oe),l.uniform1f(f.u_gap,this.gap*oe),l.uniform1f(f.u_rendering_mode,this.renderingMode==="cleartype"?1:0),l.uniform1f(f.u_sharpness,this.sharpness),l.uniform1f(f.u_bloom,this.bloom),l.uniform1f(f.u_curvature,this.curvature),l.uniform1f(f.u_vignette,this.vignette),l.uniform1f(f.u_scanlines,this.scanlines),l.uniform1f(f.u_mask_type,X),l.uniform3fv(f.u_color_temp,this.colorTemp),l.uniform1f(f.u_brightness,this.brightness),l.uniform1f(f.u_contrast,this.contrast),l.uniform1f(f.u_saturation,this.saturation),l.uniform1f(f.u_lod_bias,this.lodBias),l.uniform1f(f.u_detail_boost,this.detailBoost),l.uniform2f(f.u_canvas_resolution,P,C),l.uniform1f(f.u_noise,this.noise),l.uniform1f(f.u_flicker,this.flicker),l.uniform1f(f.u_time,i),l.uniform1f(f.u_split_x,o);let Q=0;this.outputColorspace==="linear"&&(Q=1),this.outputColorspace==="hdr"&&(Q=2),l.uniform1f(f.u_output_space,Q),l.uniform1f(f.u_quality_level,n);const v=n>=2;v&&this.beginGPUQuery(),l.drawArrays(l.TRIANGLES,0,6),v&&this.endGPUQuery()}getGPUTimeMs(){return this.lastGPUTimeMs}getOptions(){return{subpixelWidth:this.subpixelWidth,gap:this.gap,renderingMode:this.renderingMode,sharpness:this.sharpness,bloom:this.bloom,curvature:this.curvature,vignette:this.vignette,scanlines:this.scanlines,maskType:this.maskType,colorTemp:[...this.colorTemp],brightness:this.brightness,contrast:this.contrast,saturation:this.saturation,lodBias:this.lodBias,detailBoost:this.detailBoost,noise:this.noise,flicker:this.flicker,outputColorspace:this.outputColorspace}}isUsingSubImage(){return this.lastTexW>0}dispose(){const e=this.gl;this.program&&(e.deleteProgram(this.program),this.program=null),this.texture&&(e.deleteTexture(this.texture),this.texture=null),this.texturePrev&&(e.deleteTexture(this.texturePrev),this.texturePrev=null),this.buffer&&(e.deleteBuffer(this.buffer),this.buffer=null),this.prepProgram&&(e.deleteProgram(this.prepProgram),this.prepProgram=null),this.prepTexture&&(e.deleteTexture(this.prepTexture),this.prepTexture=null),this.prepFBO&&(e.deleteFramebuffer(this.prepFBO),this.prepFBO=null),this.uniforms={},this.prepUniforms={},this.videoCanvas=null,this.videoCtx=null}}function le(r){const e=document.getElementById(r);if(!e)throw new Error(`Element #${r} not found`);return e}function y(r,e,t,i){const o=le(r),n=le(e);return n.textContent=t(o.value),o.addEventListener("input",()=>{n.textContent=t(o.value),i()}),o}function wt(r){const e=y("param-width","val-width",s=>`${s}px`,v),t=y("param-gap","val-gap",s=>`${s}px`,v),i=y("param-sharpness","val-sharpness",s=>parseFloat(s).toFixed(1),v),o=y("param-bloom","val-bloom",s=>parseFloat(s).toFixed(2),v),n=y("param-curvature","val-curvature",s=>parseFloat(s).toFixed(2),v),a=y("param-vignette","val-vignette",s=>parseFloat(s).toFixed(2),v),u=y("param-scanlines","val-scanlines",s=>parseFloat(s).toFixed(2),v),l=y("param-temp","val-temp",s=>`${s}K`,v),w=y("param-saturation","val-saturation",s=>parseFloat(s).toFixed(2),v),S=y("param-contrast","val-contrast",s=>parseFloat(s).toFixed(2),v),P=y("param-brightness","val-brightness",s=>parseFloat(s).toFixed(2),v),C=y("param-lod","val-lod",s=>parseFloat(s).toFixed(2),v),Ae=y("param-detail-boost","val-detail-boost",s=>parseFloat(s).toFixed(2),v),ie=y("param-noise","val-noise",s=>parseFloat(s).toFixed(2),v),f=y("param-flicker","val-flicker",s=>parseFloat(s).toFixed(2),v),oe=le("render-grid"),X=le("render-cleartype"),Q=le("param-mask-type");oe.addEventListener("change",v),X.addEventListener("change",v),Q.addEventListener("change",v);function v(){r(se())}function se(){return{subpixelWidth:parseInt(e.value),gap:parseInt(t.value),renderingMode:X.checked?"cleartype":"grid",sharpness:parseFloat(i.value),bloom:parseFloat(o.value),curvature:parseFloat(n.value),vignette:parseFloat(a.value),scanlines:parseFloat(u.value),maskType:Q.value,colorTempK:parseInt(l.value),brightness:parseFloat(P.value),contrast:parseFloat(S.value),saturation:parseFloat(w.value),lodBias:parseFloat(C.value),detailBoost:parseFloat(Ae.value),noise:parseFloat(ie.value),flicker:parseFloat(f.value)}}function me(s){const g=(U,Me)=>document.getElementById(U)&&(document.getElementById(U).textContent=Me);s.subpixelWidth!==void 0&&(e.value=s.subpixelWidth.toString(),g("val-width",`${s.subpixelWidth}px`)),s.gap!==void 0&&(t.value=s.gap.toString(),g("val-gap",`${s.gap}px`)),s.renderingMode!==void 0&&(oe.checked=s.renderingMode==="grid",X.checked=s.renderingMode==="cleartype"),s.sharpness!==void 0&&(i.value=s.sharpness.toString(),g("val-sharpness",s.sharpness.toFixed(1))),s.bloom!==void 0&&(o.value=s.bloom.toString(),g("val-bloom",s.bloom.toFixed(2))),s.curvature!==void 0&&(n.value=s.curvature.toString(),g("val-curvature",s.curvature.toFixed(2))),s.vignette!==void 0&&(a.value=s.vignette.toString(),g("val-vignette",s.vignette.toFixed(2))),s.scanlines!==void 0&&(u.value=s.scanlines.toString(),g("val-scanlines",s.scanlines.toFixed(2))),s.maskType!==void 0&&(Q.value=s.maskType),s.colorTempK!==void 0&&(l.value=s.colorTempK.toString(),g("val-temp",`${s.colorTempK}K`)),s.brightness!==void 0&&(P.value=s.brightness.toString(),g("val-brightness",s.brightness.toFixed(2))),s.contrast!==void 0&&(S.value=s.contrast.toString(),g("val-contrast",s.contrast.toFixed(2))),s.saturation!==void 0&&(w.value=s.saturation.toString(),g("val-saturation",s.saturation.toFixed(2))),s.lodBias!==void 0&&(C.value=s.lodBias.toString(),g("val-lod",s.lodBias.toFixed(2))),s.detailBoost!==void 0&&(Ae.value=s.detailBoost.toString(),g("val-detail-boost",s.detailBoost.toFixed(2))),s.noise!==void 0&&(ie.value=s.noise.toString(),g("val-noise",s.noise.toFixed(2))),s.flicker!==void 0&&(f.value=s.flicker.toString(),g("val-flicker",s.flicker.toFixed(2)))}return{getValues:se,setValues:me}}const Fe=[{id:"trinitron",label:"Sony Trinitron",description:"Aperture Grille CRT — Warm, saturated, iconic vertical stripes",subpixelWidth:2,gap:0,renderingMode:"grid",sharpness:2,bloom:.35,curvature:.08,vignette:.25,scanlines:0,maskType:"aperture",colorTempK:6800,brightness:-.05,contrast:1.1,saturation:1.2,lodBias:-1.5,detailBoost:.5,noise:.05,flicker:.1},{id:"pvm",label:"PVM Monitor",description:"Professional broadcast CRT — Ultra-sharp, cool white, shadow mask",subpixelWidth:1,gap:1,renderingMode:"grid",sharpness:3,bloom:.1,curvature:.04,vignette:.15,scanlines:.3,maskType:"shadow",colorTempK:9300,brightness:-.08,contrast:1.2,saturation:.9,lodBias:-2,detailBoost:1,noise:.02,flicker:.05},{id:"gameboy",label:"Game Boy DMG",description:"Reflective LCD — No backlight, muted palette, strong grid",subpixelWidth:3,gap:1,renderingMode:"grid",sharpness:2.5,bloom:.05,curvature:0,vignette:0,scanlines:.2,maskType:"aperture",colorTempK:5500,brightness:-.1,contrast:1.3,saturation:.35,lodBias:-1,detailBoost:0,noise:0,flicker:0},{id:"vga",label:"VGA Sharp",description:"ClearType subpixel rendering — Ultra crisp, no CRT artifacts",subpixelWidth:2,gap:0,renderingMode:"cleartype",sharpness:1.5,bloom:.05,curvature:0,vignette:0,scanlines:0,maskType:"aperture",colorTempK:6500,brightness:0,contrast:1,saturation:1,lodBias:-1.5,detailBoost:.5,noise:0,flicker:0},{id:"arcade",label:"Arcade CRT",description:"Cabinet monitor — Heavy curvature, slot mask, vibrant glow",subpixelWidth:2,gap:1,renderingMode:"grid",sharpness:1.5,bloom:.5,curvature:.25,vignette:.5,scanlines:.15,maskType:"slot",colorTempK:7500,brightness:-.03,contrast:1.15,saturation:1.3,lodBias:-.5,detailBoost:1.5,noise:.08,flicker:.2},{id:"oled",label:"OLED Pixel",description:"Modern OLED panel — Perfect blacks, hard-edged LCD subpixel grid",subpixelWidth:3,gap:1,renderingMode:"grid",sharpness:4,bloom:0,curvature:0,vignette:0,scanlines:0,maskType:"lcd",colorTempK:6500,brightness:0,contrast:1,saturation:1.1,lodBias:-2,detailBoost:2,noise:0,flicker:0}],Pt=document.getElementById("file-input"),Ue=document.getElementById("video-input"),q=document.getElementById("img-source"),m=document.getElementById("canvas-target"),qe=document.getElementById("orig-res"),te=document.getElementById("target-res"),re=document.getElementById("btn-download"),Ct=document.getElementById("mode-fit"),_=document.getElementById("mode-inspect"),Ee=document.getElementById("json-config-area"),he=document.getElementById("btn-copy-json"),fe=document.getElementById("btn-import-json"),N=document.getElementById("split-hint"),p=document.getElementById("canvas-container"),rt=document.getElementById("video-controls"),V=document.getElementById("btn-play-pause"),J=document.getElementById("video-speed"),it=document.getElementById("val-speed"),Te=document.getElementById("video-time"),ot=document.querySelector(".vc-speed"),st=document.getElementById("live-badge"),Z=document.getElementById("param-colorspace"),z=document.getElementById("btn-webcam"),K=document.getElementById("btn-stop-webcam"),D=document.getElementById("webcam-source"),nt=document.getElementById("stat-fps"),at=document.getElementById("stat-ms"),lt=document.getElementById("stat-gpu"),ge=document.getElementById("perf-tier"),W=document.getElementById("btn-compare"),F=document.getElementById("compare-label"),b=new pt({canvas:m});let d=null,h=null,be=null,Ve=!1,E=0,T=!1,Oe=0,ct=0,ne=0,x=null,L=null;const Ft=performance.now();let De=0,Ge=performance.now();const ae=[];let ce=performance.now();function R(){return(ce-Ft)/1e3}function Rt(r){const e=r/100,t=a=>Math.max(0,Math.min(1,a)),i=e<=66?1:t(329.698727446*Math.pow(e-60,-.1332047592)/255),o=e<=66?t((99.4708025861*Math.log(e)-161.1195681661)/255):t(288.1221695283*Math.pow(e-60,-.0755148492)/255),n=e>=66?1:e<=19?0:t((138.5177312231*Math.log(e-10)-305.0447927307)/255);return[i,o,n]}const kt={low:0,medium:1,high:2},ve=["low","medium","high"];let je="auto",A=dt?"medium":"high",ut=performance.now();function k(){return kt[A]}let mt=!1,M=!1;const _e=document.getElementById("chk-smooth-motion"),xe=document.getElementById("chk-upscale-sharpen");_e==null||_e.addEventListener("change",()=>{mt=_e.checked,h&&!h.paused&&pe(h)});xe==null||xe.addEventListener("change",()=>{M=xe.checked,d&&!x&&!L&&b.render(d,_.checked,R(),E,k(),1,M)});ge==null||ge.addEventListener("change",()=>{const r=ge.value;je=r,r!=="auto"&&(A=r),$&&$.style.display!=="none"&&et()});function ye(r){const e=performance.now(),t=e-r;if(ae.push(t),ae.length>30&&ae.shift(),De++,e-Ge>=1e3){const i=De*1e3/(e-Ge),o=ae.reduce((n,a)=>n+a,0)/ae.length;if(nt&&(nt.textContent=`${i.toFixed(1)} fps`),at&&(at.textContent=`${o.toFixed(1)} ms`),je==="auto"&&e-ut>2e3){const n=ve.indexOf(A);i<45&&n>0?A=ve[n-1]:i>55&&n<ve.length-1&&(A=ve[n+1]),ut=e}De=0,Ge=e}}function we(){if(!lt)return;const r=b.getGPUTimeMs(),e=b.isUsingSubImage()?" · SubImage":"",t=je==="auto"?`Auto (${A})`:A;lt.textContent=r!==null?`${t} · GPU ${r.toFixed(2)}ms${e}`:`${t}${e}`}function ht(){if(x!==null)return;const r=e=>{if(!d){x=null;return}ce=e;const t=performance.now(),i=T?.5:E;b.render(d,_.checked,R(),i,k(),1,M),te.textContent=`${m.width} × ${m.height}`,we(),ye(t),x=requestAnimationFrame(r)};x=requestAnimationFrame(r)}function de(){x!==null&&(cancelAnimationFrame(x),x=null)}function pe(r){const e="requestVideoFrameCallback"in r;if(mt&&e){Bt(r);return}if(de(),Re(),b.resetVideoFrameState(),e){const t=i=>{if(d!==r)return;ce=i;const o=performance.now(),n=T?.5:E;b.render(r,_.checked,R(),n,k(),1,M),te.textContent=`${m.width} × ${m.height}`,He(r),we(),ye(o),!r.paused&&d===r&&(L=r.requestVideoFrameCallback(t))};L=r.requestVideoFrameCallback(t)}else{const t=i=>{if(!d||d!==r){x=null;return}ce=i;const o=performance.now(),n=T?.5:E;b.render(r,_.checked,R(),n,k(),1,M),te.textContent=`${m.width} × ${m.height}`,He(r),we(),ye(o),x=requestAnimationFrame(t)};x=requestAnimationFrame(t)}}function Re(){var r;if(L!==null&&h){const e=h;(r=e.cancelVideoFrameCallback)==null||r.call(e,L),L=null}}function Bt(r){de(),Re(),b.resetVideoFrameState();let e=performance.now(),t=1e3/30;const i=()=>{if(d!==r)return;const n=performance.now(),a=n-e;a>4&&a<250&&(t=t*.8+a*.2),e=n,b.pushVideoFrame(r),!r.paused&&d===r&&(L=r.requestVideoFrameCallback(i))};L=r.requestVideoFrameCallback(i);const o=n=>{if(!d||d!==r){x=null;return}ce=n;const a=performance.now(),u=Math.max(0,Math.min(1,(a-e)/t)),l=T?.5:E;b.render(r,_.checked,R(),l,k(),u,M),te.textContent=`${m.width} × ${m.height}`,He(r),we(),ye(a),x=requestAnimationFrame(o)};x=requestAnimationFrame(o)}const{getValues:ue,setValues:ft}=wt(r=>{ke(r)});function ke(r){const e=(Z==null?void 0:Z.value)??"srgb";b.updateOptions({subpixelWidth:r.subpixelWidth,gap:r.gap,renderingMode:r.renderingMode,sharpness:r.sharpness,bloom:r.bloom,curvature:r.curvature,vignette:r.vignette,scanlines:r.scanlines,maskType:r.maskType,colorTemp:Rt(r.colorTempK),brightness:r.brightness,contrast:r.contrast,saturation:r.saturation,lodBias:r.lodBias,detailBoost:r.detailBoost,noise:r.noise,flicker:r.flicker,outputColorspace:e}),Y()}function Y(){if(!d)return;const r=ue(),e=d instanceof HTMLVideoElement,t=e||r.noise>0||r.flicker>0;if(_.checked?(m.style.width="auto",m.style.height="auto",m.style.objectFit="none",p.style.display="block",p.style.overflow="hidden",p.style.cursor="grab",Be()):(m.style.width="100%",m.style.height="100%",m.style.objectFit="contain",p.style.display="flex",p.style.overflow="hidden",p.style.cursor="col-resize",m.style.transform="none"),e&&h)if(h.paused){const i=T?.5:E;b.render(h,_.checked,R(),i,k(),1,M),te.textContent=`${m.width} × ${m.height}`}else pe(h);else if(t)ht();else{de(),Re();const i=T?.5:E;b.render(d,_.checked,R(),i,k(),1,M),te.textContent=`${m.width} × ${m.height}`}Ee&&(Ee.value=JSON.stringify({...b.getOptions(),colorTempK:ue().colorTempK},null,2)),N&&(N.style.display="block",N.textContent=_.checked?"drag to pan · wheel to zoom · dblclick to reset":"drag to compare original vs phosphor · dblclick to reset"),re.style.display="flex"}function Lt(){T?(T=!1,E=Oe,W&&(W.textContent="⏸️ Compare View"),F&&(F.textContent="OFF",F.style.backgroundColor="rgba(255,255,255,0.1)"),p.style.cursor=_.checked?"grab":"col-resize"):(Oe=E,T=!0,W&&(W.textContent="▶️ Normal View"),F&&(F.textContent="ON",F.style.backgroundColor="rgba(245,158,11,0.2)"),E=.5,p.style.cursor="default"),d&&!x&&!L&&Y()}W&&F&&(W.addEventListener("click",Lt),F.textContent="OFF",F.style.backgroundColor="rgba(255,255,255,0.1)");Ct.addEventListener("change",()=>{Ke(),Y()});_.addEventListener("change",()=>{Ke(),Y()});Z==null||Z.addEventListener("change",()=>{ke(ue())});function ze(r,e=!1){rt&&(rt.style.display=r?"flex":"none",V&&(V.style.display=e?"none":""),ot&&(ot.style.display=e?"none":""),Te&&(Te.style.display=e?"none":""),st&&(st.style.display=e?"inline":"none"),ee(r))}function ee(r){if(V){if(!r){V.textContent="▶";return}V.textContent=r.paused?"▶ Play":"⏸ Pause"}}function He(r){if(!Te)return;const e=t=>`${Math.floor(t/60).toString().padStart(2,"0")}:${Math.floor(t%60).toString().padStart(2,"0")}`;Te.textContent=`${e(r.currentTime)} / ${e(r.duration||0)}`}V==null||V.addEventListener("click",()=>{if(h)if(h.paused)h.play().then(()=>{ee(h),h&&pe(h)});else{h.pause(),ee(h);const r=T?.5:E;b.render(h,_.checked,R(),r,k(),1,M)}});J==null||J.addEventListener("input",()=>{const r=parseFloat(J.value);it&&(it.textContent=`${r.toFixed(2)}×`),h&&(h.playbackRate=r)});let I=1,O=0,H=0;function Be(){m.style.transformOrigin="0 0",m.style.transform=`translate(${O}px, ${H}px) scale(${I})`}function Ke(){I=1,O=0,H=0,_.checked&&Be()}function gt(){const r=p.getBoundingClientRect(),e=m.width*I,t=m.height*I,i=(o,n,a)=>n<=a?Math.max(0,Math.min(a-n,o)):Math.max(a-n,Math.min(0,o));O=i(O,e,r.width),H=i(H,t,r.height)}p.addEventListener("wheel",r=>{if(!_.checked||!d)return;r.preventDefault();const e=p.getBoundingClientRect(),t=r.clientX-e.left,i=r.clientY-e.top,o=(t-O)/I,n=(i-H)/I,a=Math.exp(-r.deltaY*.001);I=Math.max(.1,Math.min(8,I*a)),O=t-o*I,H=i-n*I,gt(),Be()},{passive:!1});let Ye=!1,Je=!1,$e={x:0,y:0},Qe={x:0,y:0};p.addEventListener("pointerdown",r=>{d&&(p.setPointerCapture(r.pointerId),_.checked?(Je=!0,$e={x:r.clientX,y:r.clientY},Qe={x:O,y:H},p.style.cursor="grabbing"):T||(Ye=!0,vt(r),p.style.cursor="col-resize"))});p.addEventListener("pointermove",r=>{if(Je){O=Qe.x+(r.clientX-$e.x),H=Qe.y+(r.clientY-$e.y),gt(),Be();return}!Ye||T||vt(r)});p.addEventListener("pointerup",()=>{Ye=!1,Je=!1,p.style.cursor=_.checked?"grab":"col-resize"});p.addEventListener("dblclick",()=>{if(_.checked){Ke();return}T||(E=0,p.classList.remove("split-active"),d&&!x&&!L&&b.render(d,_.checked,R(),E,k(),1,M))});function vt(r){if(T)return;const e=p.getBoundingClientRect();E=Math.max(.02,Math.min(.98,(r.clientX-e.left)/e.width)),E>0?p.classList.add("split-active"):p.classList.remove("split-active"),d&&!x&&!L&&!T&&b.render(d,_.checked,R(),E,k(),1,M)}function Le(){de(),Re(),b.resetVideoFrameState(),d=null,h&&(h.pause(),h=null),be&&(be.getTracks().forEach(r=>r.stop()),be=null),Ve&&(Ve=!1,z&&(z.style.display=""),K&&(K.style.display="none")),ze(null),q.style.display="none",p.classList.remove("split-active"),T&&(T=!1,Oe=0,W&&(W.textContent="⏸️ Compare View"),F&&(F.textContent="OFF",F.style.backgroundColor="rgba(255,255,255,0.1)"))}async function At(){let r;try{r=await navigator.mediaDevices.getUserMedia({video:!0})}catch(e){alert("No se pudo acceder a la cámara: "+(e instanceof Error?e.message:String(e)));return}Le(),be=r,D.srcObject=r,await new Promise(e=>{D.addEventListener("loadedmetadata",()=>e(),{once:!0})}),await D.play(),d=D,h=D,Ve=!0,E=.5,p.classList.add("split-active"),qe.textContent=`${D.videoWidth} × ${D.videoHeight}`,re.textContent="↓ Export Frame",ze(D,!0),z&&(z.style.display="none"),K&&(K.style.display="flex"),pe(D)}z==null||z.addEventListener("click",()=>{At()});K==null||K.addEventListener("click",()=>{Le()});function _t(r){const e=++ct;Le();const t=new FileReader;t.onload=i=>{var o;ct===e&&(q.src=(o=i.target)==null?void 0:o.result,q.style.display="block",q.onload=()=>{d=q,E=.5,p.classList.add("split-active"),qe.textContent=`${q.naturalWidth} × ${q.naturalHeight}`,re.textContent="↓ Download PNG",Y()})},t.readAsDataURL(r)}function xt(r){const e=++ne;Le();const t=URL.createObjectURL(r),i=document.createElement("video");i.loop=!0,i.muted=!0,i.playsInline=!0,i.src=t,i.addEventListener("loadedmetadata",()=>{ne===e&&(d=i,h=i,E=.5,p.classList.add("split-active"),qe.textContent=`${i.videoWidth} × ${i.videoHeight}`,re.textContent="↓ Export Frame",ze(i),J&&(i.playbackRate=parseFloat(J.value)),N&&(N.style.display="block"),re.style.display="flex")}),i.addEventListener("loadeddata",()=>{ne===e&&i.play().then(()=>{ee(i),pe(i)})}),i.addEventListener("pause",()=>{ne===e&&ee(i)}),i.addEventListener("play",()=>{ne===e&&ee(i)})}Pt.addEventListener("change",r=>{var t;const e=(t=r.target.files)==null?void 0:t[0];e&&_t(e)});Ue==null||Ue.addEventListener("change",r=>{var t;const e=(t=r.target.files)==null?void 0:t[0];e&&xt(e)});const G=document.getElementById("drop-overlay");document.body.addEventListener("dragenter",r=>{var e;(e=r.dataTransfer)!=null&&e.types.includes("Files")&&(G==null||G.classList.add("visible"))});document.body.addEventListener("dragover",r=>{r.preventDefault()});document.body.addEventListener("dragleave",r=>{r.relatedTarget===null&&(G==null||G.classList.remove("visible"))});document.body.addEventListener("drop",r=>{var t;r.preventDefault(),G==null||G.classList.remove("visible");const e=(t=r.dataTransfer)==null?void 0:t.files[0];e&&(e.type.startsWith("video/")?xt(e):e.type.startsWith("image/")&&_t(e))});re.addEventListener("click",()=>{if(d)if(d instanceof HTMLVideoElement){const r=m.toDataURL("image/png"),e=document.createElement("a");e.href=r,e.download=`phosphor-frame-${Math.floor(d.currentTime*100)}.png`,e.click()}else{const r=x!==null;de(),b.render(d,!0,0,0);const e=m.toDataURL("image/png"),t=document.createElement("a");t.href=e,t.download="phosphor-grid-export.png",t.click(),r?ht():Y()}});Fe.forEach(r=>{const e=document.getElementById(`preset-${r.id}`);e&&e.addEventListener("click",()=>{document.querySelectorAll(".preset-btn").forEach(t=>t.classList.remove("active")),e.classList.add("active"),ft(r),ke(ue())})});he.addEventListener("click",()=>{navigator.clipboard.writeText(Ee.value).then(()=>{const r=he.textContent;he.textContent="Copied!",setTimeout(()=>he.textContent=r,1200)})});fe.addEventListener("click",()=>{try{const r=JSON.parse(Ee.value);ft(r),ke(ue());const e=fe.textContent;fe.textContent="Applied!",setTimeout(()=>fe.textContent=e,1200)}catch{alert("Invalid JSON preset configuration!")}});const Xe=document.getElementById("btn-open-comparator"),We=document.getElementById("btn-close-comparator"),$=document.getElementById("comparator-overlay"),Ne=document.getElementById("comparator-checkboxes"),Pe=document.getElementById("comparator-grid"),Ze={low:2,medium:3,high:4};let Ce=[],j=null,B=[];function bt(){if(!Ne)return;Ne.innerHTML="";const r=Ze[A];Fe.forEach(e=>{const t=document.createElement("label"),i=document.createElement("input");i.type="checkbox",i.value=e.id,i.checked=B.includes(e.id),i.addEventListener("change",()=>{if(i.checked&&B.length>=r){i.checked=!1,alert(`El tier "${A}" permite hasta ${r} comparaciones a la vez. Cambia a un tier de rendimiento mayor para más.`);return}B=i.checked?[...B,e.id]:B.filter(o=>o!==e.id),et()}),t.appendChild(i),t.append(e.label),Ne.appendChild(t)})}function Et(){Ce.forEach(r=>r.engine.dispose()),Ce=[],Pe&&(Pe.innerHTML="")}function et(){if(!Pe)return;const r=Ze[A];B.length>r&&(B=B.slice(0,r),bt()),Et(),B.forEach(e=>{const t=Fe.find(u=>u.id===e);if(!t)return;const i=document.createElement("div");i.className="comparator-cell";const o=document.createElement("canvas"),n=document.createElement("div");n.className="comparator-label",n.textContent=t.label,i.appendChild(o),i.appendChild(n),Pe.appendChild(i);const a=new pt({canvas:o});a.updateOptions(t),Ce.push({engine:a})})}function Mt(){if(j!==null)return;const r=()=>{if(!$||$.style.display==="none"){j=null;return}if(d)for(const e of Ce)d instanceof HTMLVideoElement,e.engine.render(d,!1,R(),0,k(),1,!1);j=requestAnimationFrame(r)};j=requestAnimationFrame(r)}function It(){j!==null&&(cancelAnimationFrame(j),j=null)}Xe==null||Xe.addEventListener("click",()=>{$&&($.style.display="flex",B.length===0&&(B=Fe.slice(0,Ze[A]).map(r=>r.id)),bt(),et(),Mt())});We==null||We.addEventListener("click",()=>{$&&($.style.display="none",It(),Et())});const St=new ResizeObserver(()=>{d&&!h&&!x&&!T&&Y()});St.observe(p);N&&(N.style.display="block",N.textContent="drag to compare original vs phosphor · dblclick to reset");
