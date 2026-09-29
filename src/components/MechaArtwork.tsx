import { useId, type CSSProperties } from "react";

/** Derived vector shell; approved PNGs stay untouched. No baked runtime content. */
export function MechaShell({ height, orb = false }: { height: number; orb?: boolean }) {
  const id = useId().replace(/:/g, "");
  const width = orb ? 72 : 306;
  const scale = orb ? 72 / 306 : 1;
  const h = height / scale;
  const metal = `${id}-metal`, bevel = `${id}-bevel`, face = `${id}-face`, brush = `${id}-brush`;
  const outline = `M1 25 25 1H111L120 9H200L210 1H281L305 25V${h - 25}L281 ${h - 1}H146L132 ${h - 17}H116L100 ${h - 1}H25L1 ${h - 25}Z`;
  const inset = `M10 43 43 10H110L120 18H204L214 10H273L296 34V${h - 37}L270 ${h - 10}H153L138 ${h - 25}H110L96 ${h - 10}H35L10 ${h - 35}Z`;
  const lower = h * .57;
  return <svg className="mecha-shell" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={metal} x1="0" y1="0" x2=".9" y2="1" gradientUnits="objectBoundingBox">
        <stop stopColor="#fbfdff" /><stop offset=".18" stopColor="#ccd3de" />
        <stop offset=".38" stopColor="#f3f5f8" /><stop offset=".62" stopColor="#b7c0ce" />
        <stop offset=".84" stopColor="#f3f5f9" /><stop offset="1" stopColor="#909ba9" />
      </linearGradient>
      <linearGradient id={bevel} x1="0" y1="0" x2="1" y2=".8">
        <stop stopColor="#fff" /><stop offset=".2" stopColor="#8996a7" /><stop offset=".39" stopColor="#fbfdff" />
        <stop offset=".66" stopColor="#697788" /><stop offset=".86" stopColor="#fff" /><stop offset="1" stopColor="#7d8898" />
      </linearGradient>
      <linearGradient id={face} x1="0" y1="0" x2=".85" y2="1">
        <stop stopColor="#f5f8fc" /><stop offset=".27" stopColor="#e3e9f1" /><stop offset=".53" stopColor="#f1f3f6" />
        <stop offset=".78" stopColor="#d1d8e3" /><stop offset="1" stopColor="#edf1f7" />
      </linearGradient>
      <pattern id={brush} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(42)">
        <path d="M0 0V4" stroke="#fff" strokeOpacity=".21" strokeWidth=".6" />
        <path d="M2 0V4" stroke="#8391a5" strokeOpacity=".06" strokeWidth=".5" />
      </pattern>
    </defs>
    <g transform={`scale(${scale})`}>
      <path d={outline} fill={`url(#${metal})`} stroke="#718094" strokeWidth="1.4" />
      <path d={outline} fill={`url(#${brush})`} />
      <path d={inset} fill={`url(#${face})`} stroke={`url(#${bevel})`} strokeWidth="3.1" />
      <path d={inset} fill="none" stroke="#fff" strokeOpacity=".88" strokeWidth=".7" />
      {/* Reinforced shoulders and the bottom centre tongue follow the reference shell. */}
      <path d="M2 26 25 2H57L44 15H33L9 40V64L2 57Z" fill={`url(#${metal})`} stroke="#eff4fa" />
      <path d="M258 2H281L304 25V52L267 17 260 10Z" fill={`url(#${metal})`} stroke="#737f91" />
      <path d="M258 4 269 19 302 50" fill="none" stroke="#fff" strokeWidth="2" />
      <path d={`M99 ${h - 2} 116 ${h - 19}H133L148 ${h - 2}`} fill={`url(#${metal})`} stroke="#6c7a8d" strokeWidth="2" />
      <path d={`M102 ${h - 3} 117 ${h - 17}H131L145 ${h - 3}`} fill="none" stroke="#fff" />
      {/* Recessed joints, two separated rails per side. */}
      <path d={`M2 65 12 76V96L2 105ZM304 65 294 79V104L304 115ZM2 ${lower} 12 ${lower + 12}V${lower + 48}L2 ${lower + 58}ZM304 ${lower + 4} 294 ${lower + 15}V${lower + 48}L304 ${lower + 61}Z`} fill="#758294" stroke="#f2f7ff" strokeWidth="1" />
      <path d={`M5 72V98M301 75V107M5 ${lower + 9}V${lower + 49}M301 ${lower + 13}V${lower + 52}`} stroke="#273c54" strokeWidth="2" />
      <g className="mecha-light-strip" fill="none" stroke="currentColor" strokeWidth="4.3" strokeLinejoin="miter">
        <path d="M8 39 33 15H45" /><path d="M298 66V97" />
        <path d={`M8 112V153L3 160M298 ${lower + 68}V${lower + 103}`} />
        <path d={`M273 ${h - 11} 295 ${h - 33}V${h - 25}L280 ${h - 10}Z`} />
      </g>
      <g fill="none" stroke="#f7fcff" strokeWidth="1.1">
        <path d="M8 39 33 15H45M298 66V97" /><path d={`M8 112V153M298 ${lower + 68}V${lower + 103}M277 ${h - 13} 293 ${h - 29}`} />
      </g>
      {[[9, 25], [284, 13], [17, h - 17]].map(([x, y]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
        <circle r="4.1" fill="#f7faff" stroke="#8391a5" strokeWidth=".8" />
        <circle r="2.5" fill="#627184" /><circle r="1.3" fill="#27384e" />
        <path d="m-1.3 1.4 2.6-2.6" stroke="#a7b9cb" strokeWidth=".6" />
      </g>)}
      <g fill="none" stroke="#a2aebd" strokeWidth=".7">
        <path d={`M14 ${h - 51} 36 ${h - 29}H86M161 ${h - 29}H267L287 ${h - 50}`} />
        <path d="m19 13 7-7m-3 9 7-7m-3 9 7-7" />
        <path d={`m167 ${h - 13} 4-6m0 6 4-6m0 6 4-6`} />
      </g>
    </g>
  </svg>;
}

export function MechaProgress({ percent, label, orb = false }: { percent: number; label: string; orb?: boolean }) {
  const count = orb ? 8 : 12;
  return <div className={`mecha-progress${orb ? " mecha-progress--orb" : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
    {Array.from({ length: count }, (_, index) => <i key={index} aria-hidden="true" style={{ "--mecha-fill": `${Math.min(100, Math.max(0, percent / 100 * count - index) * 100)}%` } as CSSProperties} />)}
  </div>;
}
