# Runtime icon generation and validation

Run `node scripts/generate-brand-icons.mjs` after `npm ci`. It uses the installed Tauri v2 CLI and the locked SVG sources without geometry changes. The App output replaces every existing platform artwork, including ICNS, ICO, Windows Square/Store, Android and iOS assets. The existing Android resource XML references remain applicable. iOS uses the approved navy background color instead of the CLI's default white. `icon.svg` mirrors the approved App source; `app-master-1024.png` is the full-resolution raster master.

Independent `tray-16.png`, `tray-20.png`, `tray-24.png`, and `tray-32.png` come from the three-mark Tray source. Native integration uses a dedicated tray asset rather than the default App icon.

## Local raster inspection

Both sources were rendered through Tauri at 16, 20, 24, 32, 64, 128, 256, 512 and 1024 pixels. Local contact sheets compare light and dark backgrounds, actual size through 128 px, and enlarged pixels at 16–32 px. All 18 PNGs retain transparency and contain no visible near-white pixels (RGB channels all above 240 with nonzero alpha). The reference PNG showcase backgrounds are not used as runtime input.

The C ring and violet segment remain visible in the Tray derivatives. The three Tray marks are more distinct at 24–32 px; 16 px has limited separation. The App's four bars lose separation at 16 px. The locked App SVG's filtered detached violet segment renders with a flat clipped edge; this is preserved rather than silently changing the approved source. These observations are limitations, not a declaration of visual acceptance.

## Remaining acceptance

Local raster checks do not establish Windows system Tray or macOS Menu Bar legibility. Actual light/dark Menu Bar and Windows Tray checks remain required, as does human acceptance of the small-size caveats. If native macOS readability fails, report **macOS Tray Adaptation Review Required**; a monochrome template derivative requires approval before changing the visual scheme.
