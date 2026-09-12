# Runtime icon generation and validation

## Source selection

Run `npm ci`, then `node scripts/generate-brand-icons.mjs`. The generator uses the installed Tauri CLI for SVG rasterization; no new dependency is required.

| Representation | Source |
| --- | --- |
| App 16 / 20 physical px | `app-icon-small-source.svg` |
| App 24 px and larger | `app-icon-source.svg` |
| Tray 16 / 20 physical px | `tray-icon-small-source.svg` |
| Tray 24 / 32 px and larger QA rasters | `tray-icon-source.svg` |
| ICO 16 / 20 | Tiny App raster |
| ICO 24 / 32 / 48 / 64 / 128 / 256 | Main App raster |
| ICNS logical 16 at 1x / 2x (`icp4` / `ic11`) | Tiny App raster at 16 / 32 physical px |
| Other ICNS representations, logical 32 and larger | Main App raster |
| iOS 20 physical px | Tiny App raster |
| Other existing mobile / Store artwork | Main App source through Tauri; iOS navy flattening retained |

`icon.svg` mirrors the corrected main source. `app-master-1024.png` is the full-resolution master. The ICO and ICNS containers are explicitly packed after Tauri generation so their tiny representations do not inherit the blurred master. ICNS includes both a main 32px representation for logical 32 and a tiny 32px representation for logical 16 at 2x.

Native integration is unchanged: `tauri::include_image!("icons/tray-32.png")` still supplies the main Tray raster. Generated Tray 16/20 resources are tiny derivatives, but do not imply that the running app selects them. The locked macOS tray library sizes the supplied image to 18 logical points; actual platform legibility and any need to wire a tiny runtime raster remain native acceptance gates. No template/monochrome adaptation was introduced.

## Violet filter correction

Only the main App's `soft` filter region changes: `filterUnits="userSpaceOnUse"`, `x="-64"`, `y="-64"`, `width="1152"`, `height="1152"`. Path geometry, stroke widths, gradients and element positions are unchanged. The prior object-bounding-box region cut off the detached segment's round ends. Real Tauri rasters now show both complete rounded caps with retained glow.

A wider `-128 / -128 / 1280 / 1280` control produced identical pixels at 24–256px. At 512 and 1024px, only 16 and 14 pixels differed, by at most 5 and 6 channel levels respectively; these sparse rasterization differences do not follow a clipping boundary. The adopted region removes the observed flat edges without changing geometry. [Violet before / after](validation/violet-before-after.png) shows the original and corrected 1024px raster crops at 1:1.

## Tiny adaptations

App tiny removes glow and aligns four narrower, ascending bars to the 16px grid. The C paths, violet segment, background and gradients are preserved. Tray tiny slightly narrows and spaces the existing dot plus two bars; the C paths and approved main Tray SVG are unchanged. Neither derivative changes the number of marks or substitutes the other logo.

Local raster review: **Passed** for App 16/20/24/32, violet round ends and Tray 16/20/24/32. At 16px the App has four visibly separated strokes; the Tray retains a distinguishable dot and two ascending marks. This is local raster inspection, not independent human acceptance or a native menu-bar result.

## Evidence and container checks

Both sources were rendered at 16, 20, 24, 32, 64, 128, 256, 512 and 1024px. Eighteen RGBA outputs retain transparency, with no visible near-white pixels (all RGB channels above 240 with nonzero alpha), showcase backgrounds, unintended holes or observed flat filter boundaries. No severe aliasing was observed beyond the expected resolution limits at tiny sizes.

- [Before / after, light](validation/before-after-light.png)
- [Before / after, dark](validation/before-after-dark.png)
- [All sizes, light](validation/all-sizes-light.png)
- [All sizes, dark](validation/all-sizes-dark.png)

The 16–32 comparisons include actual pixels and nearest-neighbor 4x enlargements. The all-size sheets show 16–128 at actual size; larger rasters are labeled with their displayed size. Sheets contain only generated artwork.

The eight ICO entries were independently parsed and PNG-decoded; matching PNG outputs were byte-compared. All eleven ICNS entries were independently PNG-decoded, including the tiny 16px entry, and macOS `iconutil` successfully unpacked the container. The two 32px ICNS representations were separately compared with their respective main/tiny rasters. XML comparison confirms that the main App differs only in filter attributes; the main Tray SVG and reference PNGs remain unchanged.

## Remaining acceptance

Actual macOS light/dark Menu Bar, Tray menu and Windows Tray acceptance are **not verified**. The native automation interface cannot establish pure mouse-enter behavior and did not expose the status bar successfully. Windows hardware was unavailable; the user explicitly retained that gate as unverified. Local contact sheets and container decoding do not close these gates.

If native macOS color readability fails, stop with **Blocked — macOS Tray Adaptation Review Required**. Keep version 1.1.0 until every prerequisite passes. No main merge, tag or release.
