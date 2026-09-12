"""Decode generated CM assets, check container/source mapping, and build review sheets.
Requires Pillow. Technical checks do not establish human visual/native acceptance.
"""
from pathlib import Path
from io import BytesIO
import hashlib
import json
import struct
import sys
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw, ImageFont

def pixels_of(image):
    return image.get_flattened_data() if hasattr(image, 'get_flattened_data') else image.getdata()


# Tauri's downsampler can emit RGB=255 at alpha=1 on the silhouette.
# Remove only this effectively transparent quantization fringe before packaging.
if len(sys.argv) > 1 and sys.argv[1] == '--normalize':
    for directory in sys.argv[2:]:
        for path in Path(directory).rglob('*.png'):
            image = Image.open(path).convert('RGBA')
            if path.parent.name == 'ios':
                background = Image.new('RGBA', image.size, '#101820')
                background.alpha_composite(image)
                background.convert('RGB').save(path)
                continue
            pixels = list(pixels_of(image))
            cleaned = [(0, 0, 0, 0) if a <= 1 else (r, g, b, a) for r, g, b, a in pixels]
            if pixels != cleaned:
                image.putdata(cleaned)
                image.save(path)
    sys.exit(0)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src-tauri/icons'
BRAND = ROOT / 'docs/branding/v1.2'
VALIDATION = BRAND / 'validation'
VALIDATION.mkdir(exist_ok=True)
SIZES = [16, 20, 24, 32, 48, 64, 128, 256, 512, 1024]


def decode(data):
    image = Image.open(BytesIO(data))
    image.load()
    return image.convert('RGBA')


reference = (BRAND / 'app-icon-reference.png').read_bytes()
assert len(reference) == 1316884
assert hashlib.sha256(reference).hexdigest() == '373af7dca75b1e45310c6c8b43602d44f16629c1f5225279f0efdb8c98af45c5'
assert decode(reference).size == (1254, 1254)
source = ET.parse(BRAND / 'app-icon-source.svg').getroot()
ids = {element.get('id') for element in source.iter()}
assert {'app-tile', 'letter-c', 'letter-m', 'segmented-arc', 'arc-tail'} <= ids
tiny = ET.parse(BRAND / 'app-icon-small-source.svg').getroot()
assert {'letter-c', 'letter-m', 'segmented-arc'} <= {e.get('id') for e in tiny.iter()}
for document in (source, tiny):
    assert not any(e.tag.endswith('image') for e in document.iter())
assert (OUT / 'icon.svg').read_bytes() == (BRAND / 'app-icon-source.svg').read_bytes()
app_checks = []
for size in SIZES:
    image = decode((OUT / f'app-{size}.png').read_bytes())
    assert image.size == (size, size)
    alpha = image.getchannel('A')
    assert alpha.getextrema() == (0, 255)
    assert all(image.getpixel(point)[3] == 0 for point in [(0, 0), (size-1, 0), (0, size-1), (size-1, size-1)])
    assert image.getpixel((size // 2, size // 2))[3] == 255
    # Check the translucent silhouette fringe is dark, rather than a white matte.
    assert all(max(r, g, b) < 160 for r, g, b, a in pixels_of(image) if 0 < a < 250)
    # Colour probes in reference-derived component regions. These are presence
    # signals, not an OCR/semantic or visual similarity claim.
    def region(box):
        return list(pixels_of(image.crop(tuple(round(v * size) for v in box))))
    assert any(b > 150 and b > r * 1.3 for r, g, b, a in region((.12, .35, .29, .72)))
    assert any(min(r, g, b) > 140 for r, g, b, a in region((.31, .35, .75, .60)))
    assert any(g > 110 and g > r * 1.3 for r, g, b, a in region((.53, .12, .72, .28)))
    app_checks.append({'size': size, 'alpha': 'passed', 'dark_fringe': 'passed',
                       'C_M_segments_colour_probes': 'passed'})
for size in [16, 20, 24, 32]:
    assert (OUT / f'tray-{size}.png').read_bytes() == (OUT / f'app-{size}.png').read_bytes()
for name, size in {'32x32.png': 32, '64x64.png': 64, '128x128.png': 128,
                   '128x128@2x.png': 256, 'icon.png': 1024, 'app-master-1024.png': 1024}.items():
    assert (OUT / name).read_bytes() == (OUT / f'app-{size}.png').read_bytes()

ico = (OUT / 'icon.ico').read_bytes()
reserved, kind, count = struct.unpack_from('<HHH', ico)
assert (reserved, kind, count) == (0, 1, 8)
ico_entries = []
end = 6 + 16 * count
for index in range(count):
    w, h, colors, reserved, planes, bits, length, offset = struct.unpack_from('<BBBBHHII', ico, 6 + index * 16)
    w, h = w or 256, h or 256
    assert w == h and planes == 1 and bits == 32 and offset == end
    data = ico[offset:offset + length]
    assert decode(data).size == (w, h)
    assert data == (OUT / f'app-{w}.png').read_bytes()
    ico_entries.append(w)
    end = offset + length
assert end == len(ico)
assert ico_entries == [16, 20, 24, 32, 48, 64, 128, 256]
# Also exercise Pillow's container reader, rather than only embedded PNGs.
container = Image.open(OUT / 'icon.ico')
assert container.ico.sizes() == {(size, size) for size in ico_entries}
for size in ico_entries:
    assert container.ico.getimage((size, size)).convert('RGBA').tobytes() == decode((OUT / f'app-{size}.png').read_bytes()).tobytes()

icns = (OUT / 'icon.icns').read_bytes()
assert icns[:4] == b'icns' and struct.unpack_from('>I', icns, 4)[0] == len(icns)
expected = {'icp4': (16, 1), 'icp5': (32, 1), 'icp6': (64, 1), 'ic07': (128, 1),
            'ic08': (256, 1), 'ic09': (512, 1), 'ic10': (512, 2),
            'ic11': (16, 2), 'ic12': (32, 2), 'ic13': (128, 2), 'ic14': (256, 2)}
icns_entries = []
offset = 8
while offset < len(icns):
    kind = icns[offset:offset+4].decode('ascii')
    length = struct.unpack_from('>I', icns, offset + 4)[0]
    assert length > 8 and offset + length <= len(icns)
    logical, scale = expected[kind]
    size = logical * scale
    data = icns[offset+8:offset+length]
    assert decode(data).size == (size, size)
    assert data == (OUT / f'app-{size}.png').read_bytes()
    icns_entries.append({'type': kind, 'logical': logical, 'scale': scale, 'pixels': size})
    offset += length
assert offset == len(icns) and {entry['type'] for entry in icns_entries} == set(expected)
container = Image.open(OUT / 'icon.icns')
for logical, scale in expected.values():
    decoded = container.icns.getimage((logical, logical, scale)).convert('RGBA')
    assert decoded.tobytes() == decode((OUT / f'app-{logical*scale}.png').read_bytes()).tobytes()

platform_pngs = []
for path in sorted(OUT.rglob('*.png')):
    image = decode(path.read_bytes())
    assert image.width == image.height and image.width > 0
    if path.parent.name == 'ios':
        assert image.getchannel('A').getextrema() == (255, 255)
    platform_pngs.append({'path': path.relative_to(OUT).as_posix(), 'size': image.width})
assert len(list(OUT.glob('Square*.png'))) == 9
assert (OUT / 'StoreLogo.png').is_file()
assert len(list((OUT / 'android').rglob('*.png'))) == 15
assert len(list((OUT / 'ios').glob('*.png'))) == 18
config = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text())
assert config['version'] == '1.1.0' and config['identifier'] == 'app.quotafloat.desktop'
for path in config['bundle']['icon']:
    assert (ROOT / 'src-tauri' / path).is_file()
assert 'tauri::include_image!("icons/tray-32.png")' in (ROOT / 'src-tauri/src/lib.rs').read_text()

font = ImageFont.load_default(size=22)
small_font = ImageFont.load_default(size=17)
for theme, background, foreground in [('light', '#eceff3', '#17202b'), ('dark', '#10141c', '#eef3fa')]:
    sheet = Image.new('RGBA', (1720, 1480), background)
    draw = ImageDraw.Draw(sheet)
    draw.text((32, 24), 'CM App Icon | actual pixel sizes | awaiting human visual acceptance', font=font, fill=foreground)
    x = 32
    for size in [16, 20, 24, 32, 48, 64, 128]:
        draw.text((x, 82), f'{size}px', font=small_font, fill=foreground)
        sheet.alpha_composite(decode((OUT / f'app-{size}.png').read_bytes()), (x, 118))
        x += max(size + 42, 100)
    for size, x, y in [(1024, 32, 380), (512, 1120, 380), (256, 1120, 990)]:
        draw.text((x, y - 34), f'{size}px', font=font, fill=foreground)
        sheet.alpha_composite(decode((OUT / f'app-{size}.png').read_bytes()), (x, y))
    sheet.convert('RGB').save(VALIDATION / f'cm-all-sizes-{theme}.png')
    sheet = Image.new('RGBA', (1120, 820), background)
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 20), 'CM tiny review | actual size + nearest-neighbor enlargement', font=font, fill=foreground)
    for row, prefix in enumerate(['app', 'tray']):
        for column, size in enumerate([16, 20, 24, 32]):
            x, y = 24 + column * 274, 80 + row * 360
            image = decode((OUT / f'{prefix}-{size}.png').read_bytes())
            draw.text((x, y), f'{prefix.upper()} {size}px | actual', font=small_font, fill=foreground)
            sheet.alpha_composite(image, (x, y + 30))
            factor = 200 // size
            draw.text((x, y + 76), f'{factor}x nearest-neighbor', font=small_font, fill=foreground)
            sheet.alpha_composite(image.resize((size*factor, size*factor), Image.Resampling.NEAREST), (x, y + 106))
    sheet.convert('RGB').save(VALIDATION / f'cm-tiny-{theme}.png')
report = {'scope': 'Technical validation only; human visual and native acceptance outstanding',
          'reference_sha256': hashlib.sha256(reference).hexdigest(), 'app_checks': app_checks,
          'tray_sizes': [16, 20, 24, 32], 'ico_entries': ico_entries,
          'icns_entries': icns_entries, 'decoded_pngs': platform_pngs,
          'source_mapping': '16/20px app, tray and ICO, ICNS icp4, and iOS 20px use the tiny CM SVG; other representations use the main CM SVG',
          'runtime_mapping': 'Passed; existing tray-32 include and bundle paths unchanged'}
(VALIDATION / 'technical-validation.json').write_text(json.dumps(report, indent=2) + '\n')
print(f'CM technical checks passed: {len(platform_pngs)} PNGs, {len(ico_entries)} ICO and {len(icns_entries)} ICNS entries; 4 contact sheets.')
