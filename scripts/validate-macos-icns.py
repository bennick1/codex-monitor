"""macOS container and NSImage gate. Requires Pillow, iconutil and Swift/AppKit."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import subprocess
import sys
from PIL import Image

SLOTS = {'16x16': 16, '16x16@2x': 32, '32x32': 32, '32x32@2x': 64,
         '128x128': 128, '128x128@2x': 256, '256x256': 256,
         '256x256@2x': 512, '512x512': 512, '512x512@2x': 1024}


def rgba(path):
    with Image.open(path) as image:
        return image.convert('RGBA')


def validate(icns, source):
    if sys.platform != 'darwin':
        return {'status': 'Not run — requires macOS', 'canonical_slots': None}
    with TemporaryDirectory(prefix='cm-icns-validation-') as temp:
        work = Path(temp)
        extracted = work / 'roundtrip.iconset'
        subprocess.run(['iconutil', '-c', 'iconset', '-o', str(extracted), str(icns)], check=True)
        assert {p.name for p in extracted.iterdir()} == {f'icon_{slot}.png' for slot in SLOTS}, 'Unexpected/missing native representations'
        raw = {}
        for slot, size in SLOTS.items():
            actual = rgba(extracted / f'icon_{slot}.png')
            expected = rgba(source / f'app-{size}.png')
            assert actual.size == expected.size == (size, size)
            a, e = actual.tobytes(), expected.tobytes()
            # Apple iconutil may canonicalize 16/32 1x ICNS representations as ARGB;
            # validate native NSImage rendering rather than requiring raw extracted
            # straight-RGBA equality for those slots.
            if slot in ('16x16', '32x32'):
                assert a[3::4] == e[3::4], f'{slot}: alpha mismatch'
                assert all(a[i:i+3] == e[i:i+3] for i in range(0, len(e), 4) if e[i+3] == 255), f'{slot}: opaque mismatch'
            else:
                assert a == e, f'{slot}: strict RGBA mismatch'
            raw[slot] = {'rgba_exact': a == e, 'alpha_exact': a[3::4] == e[3::4],
                         'opaque_exact': all(a[i:i+3] == e[i:i+3] for i in range(0, len(e), 4) if e[i+3] == 255),
                         'different_pixels': sum(a[i:i+4] != e[i:i+4] for i in range(0, len(e), 4))}
        rendered = work / 'rendered'
        subprocess.run(['swift', '-module-cache-path', str(work / 'swift-cache'),
                        str(Path(__file__).with_suffix('.swift')), str(icns), str(source), str(rendered)], check=True)
        native = {}
        for key in ('16@1x', '16@2x', '32@1x', '32@2x', '128@1x'):
            a, e = rgba(rendered / f'candidate-{key}.png'), rgba(rendered / f'source-{key}.png')
            assert a.size == e.size and a.tobytes() == e.tobytes(), f'{key}: NSImage RGBA mismatch'
            native[key] = 'RGBA exact'
        return {'status': 'Passed', 'canonical_slots': '10/10', 'unexpected_48': 'Absent',
                'raw_slots': raw, 'nsimage': native, 'native_render': '5/5 exact'}


if __name__ == '__main__':
    result = validate(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
    print(json.dumps(result, indent=2))
