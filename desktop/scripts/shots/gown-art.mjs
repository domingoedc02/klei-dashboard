// Port of the prototype's K.ph (js/core.js 67-84) so desktop `klei-img://` photos render the same wireframe gown as the prototype.
const G = {
  aline: 'M52 30 L68 30 L66 70 L98 146 Q60 154 22 146 L54 70 Z',
  mermaid: 'M52 30 L68 30 L67 70 Q70 110 66 118 L84 146 Q60 152 36 146 L54 118 Q50 110 53 70 Z',
  ball: 'M52 30 L68 30 L66 66 Q112 90 108 146 Q60 156 12 146 Q8 90 54 66 Z',
};
const FAB = { Lace: 'url(#pat-lace)', Tulle: 'url(#pat-tulle)', Mikado: '#ffffff' };

/** SVG document for one photo. `v` is the photo variant 0-4, same meaning as the prototype's. */
export function gownSvg(kind = 'aline', fabric = 'Mikado', v = 0) {
  const vb = v === 3 ? '34 14 52 68' : v === 4 ? '10 96 100 64' : '0 0 120 160';
  const tf = v === 1 ? 'translate(18 0) scale(0.7 1)' : 'none';
  const back = v === 2 ? '<path d="M60 32V68" stroke="currentColor" stroke-dasharray="1.5 4" stroke-width="2.5"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid slice" width="480" height="640" style="color:#8a8580">
<defs><pattern id="pat-lace" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#fff"/><circle cx="3" cy="3" r="1" fill="#a39e98"/></pattern>
<pattern id="pat-tulle" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#fff"/><path d="M0 0L5 5M5 0L0 5" stroke="#c9c5c0" stroke-width=".6"/></pattern></defs>
<rect x="-20" y="-20" width="160" height="200" fill="#ebe9e7"/>
<g transform="${tf}"><circle cx="60" cy="19" r="6" fill="#fff" stroke="currentColor" stroke-width="1.5"/>
<path d="${G[kind] || G.aline}" fill="${FAB[fabric] || '#fff'}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>${back}</g>
<path d="M10 152H110" stroke="currentColor" stroke-width="1" opacity=".35"/></svg>`;
}
