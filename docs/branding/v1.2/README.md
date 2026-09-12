# Codex Monitor v1.2 CM branding

**Correct CM Runtime Rebuilt — Awaiting Human Visual Acceptance**

## Approved Reference

The only approved visual reference is [app-icon-reference.png](app-icon-reference.png).

- Size: **1,316,884 bytes**; dimensions: **1254 × 1254**.
- SHA-256: `373af7dca75b1e45310c6c8b43602d44f16629c1f5225279f0efdb8c98af45c5`.
- Identity: **C + M + segmented monitoring arc**.
- **C + Bars = Superseded**. Old ascending bars, three-bar Tray and violet artifacts are not active sources, build inputs, runtime assets or current validation evidence.

## Maintained technical sources

- [app-icon-source.svg](app-icon-source.svg): manually traced editable paths for the central dark rounded tile, cyan-to-blue C, ice-white/light-blue M, six status ticks and fading tail arc. Gradients, rim highlight and restrained internal glow approximate the reference material. This is a technical reconstruction; exact material/visual fidelity remains subject to human review.
- [app-icon-small-source.svg](app-icon-small-source.svg): 16/20px optical derivative. Same tile, C/M geometry and composition; three spaced key ticks, no C blur glow, stronger M edge. It is not the superseded historical file that used this filename.
- Runtime [icon.svg](../../../src-tauri/icons/icon.svg) is byte-identical to the main source. Runtime master is [app-master-1024.png](../../../src-tauri/icons/app-master-1024.png).

The viewBox crops the approved reference coordinate system to `195 183 864 864`. Only the tile is drawn. No exterior gray presentation canvas or drop shadow is embedded; transparent corners and a small antialiasing margin surround the tile. No embedded reference raster, font, text mark, chart or external resource is used in either SVG.

## Rebuild

After `npm ci`, run:

```sh
node scripts/generate-brand-icons.mjs
```

Requirements: the lockfile-installed Tauri v2 CLI (validated with 2.11.4) and Python 3 with Pillow (validated with Pillow 12.3.0). If the default Python lacks Pillow, set `BRANDING_PYTHON` to an existing interpreter with Pillow. No package/version/lockfile change is required. Run from any working directory; paths resolve from the script.

The script verifies reference integrity, renders the CM SVG with Tauri, regenerates Windows Square/StoreLogo, Android and iOS assets, then creates explicit ICO/ICNS representations and review sheets. It removes alpha ≤ 1 quantization fringe and makes iOS backgrounds opaque dark blue. This postprocessing does not introduce another artwork source. Contact-sheet fonts use Pillow's bundled font.

| Output | Source |
| --- | --- |
| App and Tray 16/20px; ICO 16/20px; ICNS `icp4`; iOS 20px | Tiny CM SVG |
| App 24/32/48/64/128/256/512/1024px; Tray 24/32px | Main CM SVG |
| ICO 24/32/48/64/128/256px | Main CM SVG |
| ICNS other 1x / 2x representations | Main CM SVG at actual pixel dimensions |
| Windows Square/StoreLogo, Android, other iOS sizes | Main CM SVG through Tauri |

ICO entries: **16, 20, 24, 32, 48, 64, 128, 256**.

ICNS entries: `icp4` 16@1x, `icp5` 32@1x, `icp6` 64@1x, `ic07` 128@1x, `ic08` 256@1x, `ic09` 512@1x, `ic10` 512@2x, `ic11` 16@2x, `ic12` 32@2x, `ic13` 128@2x, `ic14` 256@2x. Retina representations are rendered at their actual pixel dimensions, so 16@2x retains the full 32px source.

Native code still includes `icons/tray-32.png`. Tray behavior and bundle configuration are unchanged.

## Technical evidence and human review

[technical-validation.json](validation/technical-validation.json) records decoded sizes and container mappings. Validation checks SVG component structure, PNG alpha/corner/fringe and component colour regions, platform decode, all ICO/ICNS PNG payloads, independent Pillow container decode, and exact container-to-generated-source mapping. These are technical presence signals, not an automatic judgment of CM recognition or visual similarity.

- [All sizes — light](validation/cm-all-sizes-light.png)
- [All sizes — dark](validation/cm-all-sizes-dark.png)
- [Tiny App + Tray — light](validation/cm-tiny-light.png)
- [Tiny App + Tray — dark](validation/cm-tiny-dark.png)

All-size sheets include actual 16/20/24/32/48/64/128/256/512/1024px rasters. Tiny sheets show actual 16/20/24/32px plus integer nearest-neighbor enlargements. Open sheets at 100% to inspect actual pixels; an automatically fitted preview changes their displayed size.

**Ready for Correct CM Icon Human Validation.** User review of App/Tray identity, tiny readability, composition and material fidelity remains outstanding. This work does not establish macOS/Windows Native Final Acceptance, menu-bar/full-screen/Dock/edge acceptance or release readiness. Version stays **1.1.0**, identifier **app.quotafloat.desktop**.
