"""Derive text-free, per-button decoration from the frozen approved PNG.

Run with Pillow and NumPy from the existing workspace runtime. No reference is
overwritten. The fixed text rectangles are diagnostic/repair regions, never an
acceptance mask. Runtime labels remain real button text. --labels adds only the
three authorized zh-CN background-bound label patches, without regenerating the
frozen reference, diagnostic masks, or already restored button backgrounds.
"""
from pathlib import Path
import hashlib
import json
import argparse
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/design/v1.3.0/mecha-light/references/expanded-three-states.png'
EVIDENCE = ROOT / 'docs/design/v1.3.0/mecha-light/tabs-reference-exact'
ASSETS = ROOT / 'assets/mecha-light/tabs-reference-exact'
EXPECTED = '6d0786a06dac5051abc403bddfa10f0227097438a54d137194899d20f1112fb1'
STATES = {
    'blue': dict(x=65, width=392, seams=[135, 253], pixels=[89, 78, 91],
                 text=[[117,550,149,567], [236,550,282,567], [364,549,412,567]]),
    'amber': dict(x=538, width=384, seams=[129,247], pixels=[87,79,92],
                  text=[[588,550,620,567], [702,550,749,567], [831,549,878,567]]),
    'red': dict(x=1000, width=387, seams=[129,247], pixels=[86,79,93],
                text=[[1052,550,1083,567], [1165,550,1212,567], [1293,549,1341,567]]),
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def normalize(image, state):
    # ONE isotropic affine mapping for the complete strip, including all labels.
    # Original y=583 is at canvas y=35 (the existing 33px layout's bottom).
    # Canvas y=0 is layout top-2; a 36px paint area fits the existing 2px/3px gaps.
    s = 258 / state['width']
    return image.transform((258,36), Image.Transform.AFFINE,
                           (1/s,0,state['x'],0,1/s,583-35/s),
                           resample=Image.Resampling.BICUBIC)

def change_flat_width(image, width):
    # Interaction-only derived state: keep both corners/step at native size.
    left, right = 18, 10
    result = Image.new('RGB',(width,image.height))
    result.paste(image.crop((0,0,left,image.height)),(0,0))
    result.paste(image.crop((left,0,image.width-right,image.height)).resize(
        (width-left-right,image.height),Image.Resampling.BICUBIC),(left,0))
    result.paste(image.crop((image.width-right,0,image.width,image.height)),(width-right,0))
    return result

def main():
    assert sha(SOURCE) == EXPECTED
    original = Image.open(SOURCE).convert('RGB')
    assert original.size == (1448,1086) and SOURCE.stat().st_size == 2564146
    ASSETS.mkdir(parents=True,exist_ok=True)
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    manifest = dict(task='CM-130-TABS-REFERENCE-EXACT-20261001', source=str(SOURCE.relative_to(ROOT)),
                    sourceSha256=EXPECTED, sourceSize=list(original.size), sourceBytes=SOURCE.stat().st_size,
                    outputCanvas=[258,36], runtimeLayout=[258,33], paintOffset=[0,-2],
                    normalization='Pillow affine BICUBIC, isotropic scale 258/sourceWidth; x0 -> 0; y583 -> 35. No local registration or warping.',
                    cropRule='x: measured full strip; y:529..586 guard band. Complete contour, seams and true bottom retained in the fixed 258x36 comparison canvas.',
                    repair='For each frozen text rectangle, interpolate RGB vertically between the immediately adjacent rows. Only pixels inside the listed rectangles change. Edges and light are untouched.',
                    states={}, derivedStates='Overview/By model selected: use the corresponding color active face, preserving left 18px and right 10px; resize only the flat middle. Last idle cap mirrors the first idle left 8px. No direct reference exists for these states.',
                    acceptance='Unresolved until full unmasked comparison and explicit human signature.')
    for name,state in STATES.items():
        original.crop((state['x'],529,state['x']+state['width'],586)).save(EVIDENCE/f'reference-{name}-original-crop.png')
        normalize(original,state).save(EVIDENCE/f'reference-{name}-1x.png')
        arr=np.array(original,dtype=float)
        mask=Image.new('L',original.size)
        for x0,y0,x1,y1 in state['text']:
            for y in range(y0,y1):
                t=(y-y0+1)/(y1-y0+1)
                arr[y,x0:x1]=arr[y0-1,x0:x1]*(1-t)+arr[y1,x0:x1]*t
            mask.paste(255,(x0,y0,x1,y1))
        clean=normalize(Image.fromarray(np.rint(arr).astype('uint8')),state)
        normalized_mask=normalize(mask.convert('RGB'),state).convert('L')
        normalized_mask.save(EVIDENCE/f'diagnostic-text-mask-{name}.png')
        # Bicubic negative lobes can otherwise change a few surrounding pixels
        # by 1–8 RGB levels. Retain original decoration outside the SAME frozen
        # repair region; neither the diagnostic mask nor the reference changes.
        clean_pixels=np.array(clean)
        untouched=np.array(normalized_mask)==0
        clean_pixels[untouched]=np.array(normalize(original,state))[untouched]
        clean=Image.fromarray(clean_pixels)
        # Three independent live button backgrounds, never a fixed whole-strip image.
        widths=state['pixels']; starts=[0,widths[0],widths[0]+widths[1]]
        direct=[clean.crop((x,0,x+w,36)) for x,w in zip(starts,widths)]
        active=direct[2]
        idle_last=change_flat_width(direct[0],widths[2])
        idle_last.paste(direct[0].crop((0,0,8,36)).transpose(Image.Transpose.FLIP_LEFT_RIGHT),(widths[2]-8,0))
        images={'first-idle':direct[0], 'middle-idle':direct[1], 'last-active':direct[2],
                'first-active':change_flat_width(active,widths[0]),
                'middle-active':change_flat_width(active,widths[1]), 'last-idle':idle_last}
        asset_entries={}
        for key,img in images.items():
            p=ASSETS/f'{name}-{key}.png';img.save(p)
            asset_entries[str(p.relative_to(ROOT))]=dict(sha256=sha(p),size=list(img.size),
                origin='direct source, with declared text repair' if key in ['first-idle','middle-idle','last-active'] else 'interaction derivative')
        s=258/state['width']
        manifest['states'][name]=dict(sourceCrop=[state['x'],529,state['x']+state['width'],586],
            scale=s, affineOutputToSource=[1/s,0,state['x'],0,1/s,583-35/s],
            sourceSeams=state['seams'], runtimeWidths=widths,
            textRepairRectangles=state['text'],
            geometry=dict(idleTopY=538, activeTopY=533, bevelStartY=570, brightBottomY=578, trueBottomY=582,
                          activeTopLift=5*s, activeLeftStepApproxSource=[state['x']+state['seams'][1],570,18,10]),
            assets=asset_entries)
    (EVIDENCE/'reference-map.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'assets':len(STATES)*6,'sourceUnchanged':sha(SOURCE)==EXPECTED,'map':str(EVIDENCE/'reference-map.json')}))

def derive_labels(colors, direct_only=False):
    """C is flattened: these are background-bound patches, NOT recovered alpha.

    Direct states keep C exactly inside the existing normalized repair support.
    Interaction derivatives adapt the same label to B' with a two-sided
    contrast estimate, retaining dark strokes and white fringe. This estimate
    is NOT recovered source alpha. No glyph is resized, redrawn or moved to
    another label key; no source panel rectangle is pasted onto another panel.
    """
    assert sha(SOURCE) == EXPECTED
    original = Image.open(SOURCE).convert('RGB')
    reference_map = json.loads((EVIDENCE/'reference-map.json').read_text())
    entries = []
    for color in colors:
        state = STATES[color]
        frozen = reference_map['states'][color]
        reference = normalize(original, state)
        assert np.array_equal(np.array(reference), np.array(Image.open(EVIDENCE/f'reference-{color}-1x.png').convert('RGB')))
        mask = np.array(Image.open(EVIDENCE/f'diagnostic-text-mask-{color}.png')) > 0
        widths = state['pixels']
        starts = [0, widths[0], widths[0]+widths[1]]
        for index, (label, text, slot) in enumerate(zip(
                ['overview','models','turns'], ['总览','按模型','额度周'], ['first','middle','last'])):
            source_state = 'active' if label == 'turns' else 'idle'
            source_path = ASSETS/f'{color}-{slot}-{source_state}.png'
            assert sha(source_path) == frozen['assets'][str(source_path.relative_to(ROOT))]['sha256']
            source_panel = np.array(Image.open(source_path).convert('RGB'), dtype=np.int16)
            source_composite = np.array(reference.crop((starts[index],0,starts[index]+widths[index],36)), dtype=np.int16)
            support = mask[:, starts[index]:starts[index]+widths[index]]
            ys, xs = np.where(support)
            x0,y0,x1,y1 = int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)
            residual = (source_composite-source_panel)[y0:y1,x0:x1]
            alpha = support[y0:y1,x0:x1]
            composite_crop = source_composite[y0:y1,x0:x1].astype(float)
            background_crop = source_panel[y0:y1,x0:x1].astype(float)
            # A raw signed RGB residual tinted opaque strokes when transferring
            # warm active labels onto neutral idle panels. Estimate ONLY how
            # much background can show through: darkest source ink and white
            # fringe anchor both contrast directions. Preserve source ink at
            # high coverage; adapt the background where coverage is near zero.
            ink = composite_crop[alpha].min(axis=0)
            dark = np.max((background_crop-composite_crop)/np.maximum(background_crop-ink,1),axis=2)
            light = np.max((composite_crop-background_crop)/np.maximum(255-background_crop,1),axis=2)
            transmission = 1-np.clip(np.maximum(dark,light),0,1)
            assert not np.any((source_composite-source_panel)[~support]), 'Existing panel changed outside frozen repair support'
            for target_state in ([source_state] if direct_only else ['idle','active']):
                direct = target_state == source_state
                panel_path = ASSETS/f'{color}-{slot}-{target_state}.png'
                panel_hash = frozen['assets'][str(panel_path.relative_to(ROOT))]['sha256']
                assert sha(panel_path) == panel_hash
                target_panel = np.array(Image.open(panel_path).convert('RGB'), dtype=np.int16)
                # Preserve the existing selected-label upward step for derived
                # states only; directly referenced anchors stay exactly frozen.
                y_shift = 0 if direct else (-1 if target_state == 'active' else 1)
                target_y = y0+y_shift
                target_background = target_panel[target_y:target_y+y1-y0,x0:x1]
                rgb = source_composite[y0:y1,x0:x1] if direct else np.rint(np.clip(
                    composite_crop+(target_background-background_crop)*transmission[:,:,None],0,255))
                pixels = np.zeros((y1-y0,x1-x0,4), dtype=np.uint8)
                pixels[:,:,:3] = rgb.astype(np.uint8)
                pixels[:,:,3] = alpha.astype(np.uint8)*255
                path = ASSETS/f'{color}-label-{label}-{target_state}.png'
                Image.fromarray(pixels).save(path)
                # Prove generation composition separately from runtime screenshots.
                composed = target_panel.copy()
                region = composed[target_y:target_y+y1-y0,x0:x1]
                region[alpha] = rgb[alpha]
                if direct:
                    assert np.array_equal(composed,source_composite)
                entries.append(dict(
                    id=f'zh-CN:{label}:{color}-turns:{target_state}:{panel_path.stem}',
                    locale='zh-CN', labelKey=label, label=text, color=color,
                    sourceState='turns-selected', renderState=target_state,
                    panelBackgroundId=panel_path.stem, panelAsset=panel_path.name,
                    panelSha256=panel_hash, sourceTextRectangle=state['text'][index],
                    normalizedSourceRectangle=[starts[index]+x0,y0,starts[index]+x1,y1],
                    paintRectangle=[x0,target_y,x1-x0,y1-y0],
                    buttonRectangle=[x0,target_y-2,x1-x0,y1-y0],
                    asset=path.name, size=[x1-x0,y1-y0], sha256=sha(path),
                    assetType='background-bound label patch', directReference=direct,
                    method='exact normalized source composite inside frozen repair support' if direct
                        else 'source composite + (target background - source background) * estimated background transmission; transmission from source dark-ink/white-fringe contrast; rounded uint8; background-bound derivative, NOT recovered alpha',
                    provenance='Project-approved generated reference PNG; not Exo 2 or an OFL glyph',
                    alpha='binary support of the existing repair region, NOT glyph opacity',
                    registration=frozen['affineOutputToSource']))
    manifest = dict(task='CM-130-TABS-TEXT-LAYER-FINAL-20261002',
        source=str(SOURCE.relative_to(ROOT)), sourceSha256=EXPECTED,
        referenceMapSha256=sha(EVIDENCE/'reference-map.json'),
        normalization=reference_map['normalization'], outputCanvas=[258,36],
        assetType='background-bound label patch',
        boundary='Only the existing normalized repair support. No mask expansion, border or panel changes.',
        derivedStates='Overview/models selected are interaction derivatives, never direct pixel-reference acceptance.',
        entries=entries)
    (ASSETS/'label-patches.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(patches=len(entries),direct=sum(e['directReference'] for e in entries),
        manifest=str(ASSETS/'label-patches.json'),sourceUnchanged=sha(SOURCE)==EXPECTED)))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--labels', nargs='+', choices=list(STATES))
    parser.add_argument('--direct-only', action='store_true')
    args = parser.parse_args()
    if args.labels:
        derive_labels(args.labels, args.direct_only)
    else:
        main()
