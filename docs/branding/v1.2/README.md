# Codex Monitor v1.2 Branding Source of Truth

## Approved visual source

`app-icon-reference.png` is the only currently approved v1.2 icon visual source.

It is the user-selected original **CM** design:

- dark rounded-square app tile;
- large cyan/blue **C** monitoring ring;
- white-to-light-blue **M** monogram in the center;
- segmented status ticks on the upper-right arc;
- no data-bar chart inside the C;
- no separate approved Tray redesign yet.

The file is a reduced raster reference of the exact approved visual direction. It is the comparison source for rebuilding technical SVG/runtime assets.

## Correction notice

All previous v1.2 branding assets based on the **C-ring + ascending data bars** design were created from the wrong candidate and are invalidated.

They must not be reused as App, Tray, tiny-size, ICO, ICNS, Windows Store, Android, iOS, or validation sources.

The previous runtime icon validation/contact-sheet evidence for that wrong candidate is also invalidated.

## Runtime state after correction

Until the approved CM design is rebuilt into runtime assets, the branch intentionally falls back to the pre-v1.2 runtime icon set. `tray-32.png` is only a compatibility copy of the previous 32px icon so the current dedicated Tray code path remains buildable.

Do not treat that compatibility icon as the v1.2 design.

## Next implementation rule

Recreate App/Tray technical sources from `app-icon-reference.png`, validate them against the reference, regenerate every runtime platform asset, and only then resume native icon acceptance.

Do not change the product feature implementation, Schema 3, Token accounting, quota observation rules, or By Turn behavior while correcting branding.
