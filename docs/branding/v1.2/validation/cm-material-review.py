"""Reproduce material-only geometry/tiny checks and Reference / Before / After sheets.
Run with Python + Pillow after node scripts/generate-brand-icons.mjs.
Before is read from the accepted Git baseline, never from an unlabelled raster.
"""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT = Path(__file__).resolve().parents[4]
BASE = '93ce0b2684cb7272bb30ccc8cb56fa045d0c3bb8'
BRAND = 'docs/branding/v1.2/'
OUT = 'src-tauri/icons/'
DEST = ROOT / BRAND / 'validation'


def before(path):
    return subprocess.check_output(['git', 'show', f'{BASE}:{path}'], cwd=ROOT)


def current(path):
    return (ROOT / path).read_bytes()


def decoded(data):
    image = Image.open(BytesIO(data))
    image.load()
    return image.convert('RGBA')


def digest(data):
    return hashlib.sha256(data).hexdigest()


reference = current(BRAND + 'app-icon-reference.png')
assert reference == before(BRAND + 'app-icon-reference.png')
assert len(reference) == 1316884
assert digest(reference) == '373af7dca75b1e45310c6c8b43602d44f16629c1f5225279f0efdb8c98af45c5'
assert decoded(reference).size == (1254, 1254)
old_svg = ET.fromstring(before(BRAND + 'app-icon-source.svg'))
new_svg = ET.fromstring(current(BRAND + 'app-icon-source.svg'))
# Additional uses are explicitly permitted material overlays. They reference
# existing path definitions, contain no geometry/transform and cannot extend them.
overlays = {'c-cyan-light-overlay': '#c', 'c-mint-light-overlay': '#c', 'm-ice-light-overlay': '#m'}
geometry_tags = {'svg', 'path', 'rect', 'ellipse', 'circle', 'line', 'polygon', 'polyline', 'clipPath', 'use'}
geometry_attributes = {'d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points',
                       'viewBox', 'transform', 'href', 'stroke-width', 'clip-path'}


def geometry(root):
    result = []
    for element in root.iter():
        if element.get('id') in overlays:
            assert element.tag.endswith('use')
            assert element.get('href') == overlays[element.get('id')]
            assert set(element.attrib) == {'id', 'href', 'fill'}
            continue
        if element.tag.split('}')[-1] in geometry_tags:
            result.append((element.tag, {key: value for key, value in element.attrib.items() if key in geometry_attributes}))
        # Also disallow material transforms on ancestor groups.
        if element.tag.endswith('g'):
            assert 'transform' not in element.attrib
    return result


assert geometry(old_svg) == geometry(new_svg), 'Blocked — CM Geometry Drift'
for tag in ('path', 'rect', 'ellipse', 'clipPath'):
    assert sum(e.tag.split('}')[-1] == tag for e in old_svg.iter()) == sum(e.tag.split('}')[-1] == tag for e in new_svg.iter())
assert before(BRAND + 'app-icon-small-source.svg') == current(BRAND + 'app-icon-small-source.svg')
for path in ('scripts/generate-brand-icons.mjs', 'scripts/validate-brand-icons.py'):
    assert before(path) == current(path)
tiny_files = [OUT + f'{kind}-{size}.png' for kind in ['app', 'tray'] for size in [16, 20]]
tiny_files.append(OUT + 'ios/AppIcon-20x20@1x.png')
for path in tiny_files:
    assert before(path) == current(path), f'Tiny bytes changed: {path}'
alpha_checks = []
for size in [16, 20, 24, 32, 48, 64, 128, 256, 512, 1024]:
    old = decoded(before(OUT + f'app-{size}.png'))
    new = decoded(current(OUT + f'app-{size}.png'))
    oa, na = old.getchannel('A'), new.getchannel('A')
    # Lighting is confined to the tile; no new interior transparent holes.
    interior = oa.point(lambda value: 255 if value == 255 else 0)
    missing = na.point(lambda value: 255 if value < 255 else 0)
    assert ImageChops.multiply(interior, missing).getbbox() is None
    assert na.getbbox() == oa.getbbox()
    alpha_checks.append({'size': size, 'same_alpha_bbox': True, 'no_new_transparent_holes': True,
                         'alpha_byte_identical': oa.tobytes() == na.tobytes()})
# Main blur has 20% filter padding (> 3 sigma) and remains well inside the tile.
blur = next(e for e in new_svg.iter() if e.get('id') == 'soft-glow')
sigma = float(next(iter(blur)).get('stdDeviation'))
assert sigma * 3 < min(421 * .2, 613 * .2, 307 - 199, 298 - 187)
assert blur.get('x') == '-20%' and blur.get('width') == '140%'

# Display-only crop follows the frozen viewBox. At transparent rounded corners,
# the baseline silhouette masks the presentation background/shadow. The approved
# PNG is never written back or used as a runtime input.
reference_tile = decoded(reference).crop((195, 183, 1059, 1047))
font = ImageFont.load_default(size=25)
small = ImageFont.load_default(size=19)
layout = [(256, 130), (512, 480), (1024, 1080)]
for theme, bg, fg in [('light', '#eceff3', '#17202b'), ('dark', '#10141c', '#eef3fa')]:
    sheet = Image.new('RGBA', (3216, 2160), bg)
    draw = ImageDraw.Draw(sheet)
    draw.text((32, 20), 'CM MATERIAL | REFERENCE / BEFORE / AFTER | Human visual acceptance pending', font=font, fill=fg)
    draw.text((32, 60), 'Actual 256 / 512 / 1024 pixels. Reference: tile-only crop; Before: 93ce0b2; After: current CM source.', font=small, fill=fg)
    for size, y in layout:
        original = decoded(before(OUT + f'app-{size}.png'))
        polished = decoded(current(OUT + f'app-{size}.png'))
        ref = reference_tile.resize((size, size), Image.Resampling.LANCZOS)
        ref.putalpha(original.getchannel('A'))
        for column, (label, image) in enumerate([('REFERENCE', ref), ('BEFORE', original), ('AFTER', polished)]):
            x = 32 + column * 1064
            draw.text((x, y - 34), f'{label} | {size}px', font=font, fill=fg)
            sheet.alpha_composite(image, (x, y))
    sheet.convert('RGB').save(DEST / f'cm-material-compare-{theme}.png')
report = {
    'baseline': BASE, 'reference_unchanged': True, 'geometry_unchanged': True,
    'geometry_records_compared': len(geometry(old_svg)),
    'material_overlays': overlays, 'tiny_source_unchanged': True,
    'generator_and_existing_validator_unchanged': True,
    'tiny_byte_identical': {path: digest(current(path)) for path in tiny_files},
    'alpha_checks': alpha_checks, 'glow_3sigma_inside_filter_and_tile': True,
    'comparison_sizes': [256, 512, 1024],
    'reference_display': 'Frozen viewBox crop, baseline silhouette alpha for presentation corners only',
    'human_visual_acceptance': 'Pending; no similarity score or tool inspection establishes acceptance'
}
(DEST / 'cm-material-technical-validation.json').write_text(json.dumps(report, indent=2) + '\n')
print('Material checks passed: geometry frozen, tiny bytes frozen, generator unchanged; 2 comparison sheets generated.')
