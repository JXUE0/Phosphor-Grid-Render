# Phosphor Grid Simulator

A GPU‑accelerated CRT phosphor sub‑pixel renderer built with **TypeScript**, **WebGL 2** and **Vite**. Decompose each source pixel into its physical R, G, B sub‑pixel components (stripes/dots) and simulate real display optics such as aperture grille, shadow mask, phosphor bloom, curvature, vignette, scanlines, noise and flicker.

> **Live demo:** [https://JXUE0.github.io/Phosphor-Grid-Render/]

## Features

- **Physical Grid** (LCD/CRT) and **ClearType** rendering modes  
- Authentic monitor presets (Trinitron, PVM, Game Boy, VGA, Arcade, OLED)  
- Analog effects: film grain, phosphor flicker, vignette, scanlines  
- CRT optics: curvature, vignette, beam bloom  
- Color temperature calibration (Kelvin → RGB)  
- HDR / Linear / sRGB output color spaces  
- Video source support (webcam, local video, drag‑&‑drop)  
- Split‑view comparison (original ↔ phosphor) with draggable divider  
- Performance tiers (Low/Medium/High/Auto) that gate cosmetic shader passes  
- Smooth motion & FSR‑style upscaling for video  
- JSON preset import/export  
- Responsive UI with dark theme and accessible controls  

## Installation

```bash
# Clone the repo
git clone https://github.com/JXUE0/Phosphor-Grid-Render.git
cd Phosphor-Grid-Render

# Install dependencies (pnpm is used, but npm/yarn work too)
pnpm install   # or: npm install

# Start the dev server
pnpm dev       # or: npm run dev
```

Open <http://localhost:5100> in your browser.

## Usage

1. **Load a source** – click **↑ Upload Image**, **▶ Upload Video**, or **⏺ Use Webcam**. You can also drag & drop any image/video file onto the page.  
2. **Choose a preset** – click one of the monitor buttons (Trinitron, PVM, …) to instantly apply a realistic configuration.  
3. **Tweak parameters** – use the sliders, radios and checkboxes to adjust sub‑pixel width, gap, sharpness, bloom, curvature, etc.  
4. **Enable analog effects** – increase **Noise** (film grain) or **Flicker** (phosphor persistence) to see animated noise.  
5. **Split‑view** – drag the vertical divider to compare the original source on the left with the phosphor‑rendered result on the right.  
6. **Export** – press **↓ Download PNG** to capture the current frame (for images) or the current video frame (for video).  
7. **Presets** – use **⊞ Compare Presets** to open a comparator that shows several presets side‑by‑side.  
8. **JSON** – copy the current configuration with **Copy JSON**, edit it, and paste back then press **Apply JSON**.

### Control Panel Reference

Each control modifies a specific aspect of the phosphor simulation. Below is a brief explanation of what each option does:

| Section | Control | What it does |
|---------|---------|--------------|
| **Subpixel Grid** | **Subpixel Width** | Physical width of one R/G/B stripe in screen pixels. Larger values create a more pronounced grid. |
| | **Stripe Gap** | Dark space between sub‑pixel triads. Simulates the black mask between phosphor stripes. |
| **Rendering Mode** | **Physical Grid** | Samples one color per fragment (classic CRT/LCD sub‑pixel layout). |
| | **ClearType AA** | Offsets R/G/B by 1/3 sub‑pixel for sub‑pixel anti‑aliasing (ClearType style). |
| **Phosphor Mask** | **Mask Type** | Choose the phosphor/aperture pattern: <br>• **Aperture Grille** – vertical stripes (Trinitron) <br>• **Shadow Mask** – circular dots (PVM) <br>• **Slot Mask** – slotted holes (Arcade) <br>• **LCD / OLED** – hard‑edged rectangular sub‑pixels |
| | **Sharpness** | Exponent of the cosine‑shaped phosphor falloff. Higher = sharper edges, lower = more bloom. |
| | **Beam Bloom** | Amount of light bleeding from each phosphor stripe into its neighbours. |
| **CRT Optics** | **Curvature** | Simulates CRT barrel distortion (0 = flat screen). |
| | **Vignette** | Darkens the corners to mimic lens shading and screen curvature. |
| | **Scanlines** | Adds horizontal scan line intensity (0 = none, 1 = full strength). |
| **Analog Effects** | **Film Grain** | Adds monochrome noise after gamma (cosmetic, only active at Medium/High quality). |
| | **Phosphor Flicker** | Temporal variation of phosphor persistence, simulating analog refresh instability. |
| **Color Space** | **Output Color Space** | <br>• **sRGB** – standard IEC 61966‑2‑1 gamma (default) <br>• **Linear** – raw phosphor energy (no gamma) <br>• **HDR** – Reinhard tone‑mapping to extend highlights |
| **Color Temperature** | **White Point (Kelvin)** | Adjusts the RGB gain to simulate different phosphor temperatures (warm = low K, cool = high K). |
| **Color Calibration** | **Saturation**, **Contrast**, **Black Level** | Standard color‑adjustment multipliers applied in linear light space. |
| **Texture Sampling** | **LOD Bias** | Negative values sharpen the texture (less blur), positive values blur it. |
| | **Detail Boost** | Emphasizes high‑frequency details (stars/sparks) by comparing two mipmap levels. |
| **Performance** | **Performance Tier** | Limits cosmetic shader passes (grain, detail‑boost, GPU profiling) to keep FPS high. The canvas resolution is *always* full‑screen; only optional passes are gated. |
| **Video Enhancement** | **Smooth Motion** | Uses `requestVideoFrameCallback` + a separate RAF loop to temporally blend frames, giving smoother playback for low‑fps video. |
| | **Sharp Upscale** | Applies a FSR‑style Catmull‑Rom upscale + clamped sharpen before the phosphor mask. |
| **Diagnostics** | **FPS / Render Time / GPU Alloc** | Real‑time performance stats shown in the lower‑left corner. |


## License

This project is open source and available under the **MIT License** – see the [`LICENSE`](LICENSE) file for details.

## Acknowledgments

- Inspired by classic CRT phosphor simulations and the work of the demoscene community.  
- Fonts: **Bricolage Grotesque**, **Inter**, **JetBrains Mono** (via Google Fonts).  
- Built with **Vite**, **TypeScript**, and **WebGL 2**.  

---

*Happy hacking! If you have questions or suggestions, feel free to open an issue or submit a pull request.*  