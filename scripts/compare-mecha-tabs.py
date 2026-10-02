"""Full unmasked comparison; fixed diagnostic regions never determine acceptance."""
from pathlib import Path
import sys,json
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/design/v1.3.0/mecha-light/tabs-reference-exact'
PHASE=sys.argv[1] if len(sys.argv)>1 else 'actual'
REFERENCE_MAP=json.loads((BASE/'reference-map.json').read_text())

def metrics(delta,region=None):
    d=delta if region is None else delta[region]
    changed=np.any(d!=0,axis=-1)
    return dict(pixels=int(changed.size), differentPixels=int(changed.sum()), maxChannelDifference=int(d.max()),
                meanAbsoluteChannelDifference=float(d.mean()), exact=not bool(changed.any()))

results={}
for state in (sys.argv[2:] or ['blue','amber','red']):
    assert state in ['blue','amber','red']
    ref=Image.open(BASE/f'reference-{state}-1x.png').convert('RGB')
    actual=Image.open(BASE/PHASE/f'{state}-turns-full-tabs.png').convert('RGB')
    assert ref.size==actual.size==(258,36)
    a,b=np.array(ref,dtype=np.int16),np.array(actual,dtype=np.int16)
    delta=np.abs(a-b).astype('uint8')
    # This mask was frozen before the first reference-driven implementation.
    text=np.array(Image.open(BASE/f'diagnostic-text-mask-{state}.png'))>0
    ys,xs=np.indices(text.shape)
    edges=(ys<9)|(ys>=28)|(xs<8)|(xs>=250)
    widths=REFERENCE_MAP['states'][state]['runtimeWidths']
    joints=(abs(xs-widths[0])<=4)|(abs(xs-widths[0]-widths[1])<=4)
    active_x=widths[0]+widths[1]
    light=(xs>=active_x)&((ys<10)|(ys>=28)|(xs<active_x+8)|(xs>=250))
    metal=~(text|edges|joints|light)
    result=dict(full=metrics(delta), textDiagnostic=metrics(delta,text),
                outsideTextDiagnostic=metrics(delta,~text), contourDiagnostic=metrics(delta,edges),
                seamsDiagnostic=metrics(delta,joints), bottomDiagnostic=metrics(delta,ys>=28),
                selectedLightDiagnostic=metrics(delta,light), metalFaceDiagnostic=metrics(delta,metal),
                note='No acceptance threshold or mask. Full region is the primary result.')
    Image.fromarray(delta).save(BASE/PHASE/f'{state}-diff-1x.png')
    Image.blend(ref,actual,.5).save(BASE/PHASE/f'{state}-overlay-1x.png')
    for label,im in [('reference',ref),('actual',actual),('overlay',Image.blend(ref,actual,.5)),('diff',Image.fromarray(delta))]:
        im.resize((1032,144),Image.Resampling.NEAREST).save(BASE/PHASE/f'{state}-{label}-4x.png')
    # Direct concatenation only; Actual is not retouched or resampled for 1x.
    board=Image.new('RGB',(1032,144*4),'white')
    for i,im in enumerate([ref,actual,Image.blend(ref,actual,.5),Image.fromarray(delta)]):
        board.paste(im.resize((1032,144),Image.Resampling.NEAREST),(0,i*144))
    board.save(BASE/PHASE/f'{state}-comparison-4x.png')
    results[state]=result
(BASE/PHASE/'differences.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
