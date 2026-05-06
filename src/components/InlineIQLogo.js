import React from 'react';
import { SvgXml } from 'react-native-svg';

const SVG = `<svg width="680" height="340" viewBox="0 0 680 340" xmlns="http://www.w3.org/2000/svg">
<polygon points="270,145 340,72 410,145 340,218" fill="none" stroke="#00C5CC" stroke-width="0.75" opacity="0.08"/>
<line x1="106" y1="88" x2="285" y2="145" stroke="#00C5CC" stroke-width="1" stroke-opacity="0.35"/>
<line x1="106" y1="145" x2="285" y2="145" stroke="#00C5CC" stroke-width="1" stroke-opacity="0.35"/>
<line x1="106" y1="202" x2="285" y2="145" stroke="#00C5CC" stroke-width="1" stroke-opacity="0.35"/>
<line x1="395" y1="145" x2="574" y2="88" stroke="#00C5CC" stroke-width="1" stroke-opacity="0.85"/>
<line x1="395" y1="145" x2="574" y2="145" stroke="#00C5CC" stroke-width="1.5" stroke-opacity="0.9"/>
<line x1="395" y1="145" x2="574" y2="202" stroke="#00C5CC" stroke-width="1" stroke-opacity="0.85"/>
<polygon points="106,81 113,88 106,95 99,88" fill="none" stroke="#00C5CC" stroke-width="1.5" opacity="0.28"/>
<polygon points="106,138 113,145 106,152 99,145" fill="none" stroke="#00C5CC" stroke-width="1.5" opacity="0.28"/>
<polygon points="106,195 113,202 106,209 99,202" fill="none" stroke="#00C5CC" stroke-width="1.5" opacity="0.28"/>
<circle cx="141" cy="97" r="2" fill="#00C5CC" opacity="0.18"/>
<circle cx="183" cy="112" r="2.5" fill="#00C5CC" opacity="0.3"/>
<circle cx="237" cy="131" r="3" fill="#00C5CC" opacity="0.48"/>
<circle cx="147" cy="145" r="2" fill="#00C5CC" opacity="0.18"/>
<circle cx="196" cy="145" r="2.5" fill="#00C5CC" opacity="0.3"/>
<circle cx="248" cy="145" r="3" fill="#00C5CC" opacity="0.48"/>
<circle cx="141" cy="193" r="2" fill="#00C5CC" opacity="0.18"/>
<circle cx="183" cy="178" r="2.5" fill="#00C5CC" opacity="0.3"/>
<circle cx="237" cy="159" r="3" fill="#00C5CC" opacity="0.48"/>
<circle cx="433" cy="131" r="3.5" fill="#00C5CC" opacity="0.62"/>
<circle cx="482" cy="112" r="4" fill="#00C5CC" opacity="0.78"/>
<circle cx="536" cy="97" r="4.5" fill="#00C5CC" opacity="0.94"/>
<circle cx="431" cy="145" r="3.5" fill="#00C5CC" opacity="0.62"/>
<circle cx="480" cy="145" r="4" fill="#00C5CC" opacity="0.78"/>
<circle cx="532" cy="145" r="5" fill="#00C5CC" opacity="0.96"/>
<circle cx="433" cy="159" r="3.5" fill="#00C5CC" opacity="0.62"/>
<circle cx="482" cy="178" r="4" fill="#00C5CC" opacity="0.78"/>
<circle cx="536" cy="193" r="4.5" fill="#00C5CC" opacity="0.94"/>
<circle cx="574" cy="88" r="6.5" fill="#00C5CC" opacity="0.88"/>
<circle cx="574" cy="145" r="7.5" fill="#00C5CC" opacity="0.92"/>
<circle cx="574" cy="202" r="6.5" fill="#00C5CC" opacity="0.88"/>
<polygon points="285,145 340,88 395,145 340,202" fill="#07090F" stroke="#00C5CC" stroke-width="1.5" opacity="0.9"/>
<ellipse cx="340" cy="145" rx="44" ry="15" fill="none" stroke="#00C5CC" stroke-width="1.5" stroke-opacity="0.72"/>
<ellipse cx="340" cy="145" rx="44" ry="15" fill="none" stroke="#00C5CC" stroke-width="1.5" stroke-opacity="0.52" transform="rotate(60,340,145)"/>
<ellipse cx="340" cy="145" rx="44" ry="15" fill="none" stroke="#00C5CC" stroke-width="1.5" stroke-opacity="0.40" transform="rotate(-60,340,145)"/>
<circle cx="296" cy="145" r="7" fill="#00C5CC" opacity="0.08"/>
<circle cx="296" cy="145" r="3" fill="#00C5CC" opacity="0.32"/>
<circle cx="384" cy="145" r="10" fill="#00C5CC" opacity="0.1"/>
<circle cx="384" cy="145" r="4.5" fill="#00C5CC" opacity="0.88"/>
<circle cx="318" cy="107" r="7" fill="#00C5CC" opacity="0.08"/>
<circle cx="318" cy="107" r="3" fill="#00C5CC" opacity="0.32"/>
<circle cx="362" cy="183" r="10" fill="#00C5CC" opacity="0.1"/>
<circle cx="362" cy="183" r="4.5" fill="#00C5CC" opacity="0.82"/>
<circle cx="362" cy="107" r="10" fill="#00C5CC" opacity="0.1"/>
<circle cx="362" cy="107" r="4.5" fill="#00C5CC" opacity="0.82"/>
<circle cx="318" cy="183" r="7" fill="#00C5CC" opacity="0.08"/>
<circle cx="318" cy="183" r="3" fill="#00C5CC" opacity="0.32"/>
<circle cx="340" cy="145" r="26" fill="#00C5CC" opacity="0.03"/>
<circle cx="340" cy="145" r="19" fill="#00C5CC" opacity="0.06"/>
<circle cx="340" cy="145" r="13" fill="#00C5CC" opacity="0.11"/>
<circle cx="340" cy="145" r="8" fill="#00C5CC" opacity="0.22"/>
<circle cx="340" cy="145" r="5" fill="#00C5CC" opacity="0.55"/>
<circle cx="340" cy="145" r="2.5" fill="#FFFFFF" opacity="0.92"/>
<text x="340" y="266" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="200" letter-spacing="10" fill="#FFFFFF">inline<tspan font-weight="800" letter-spacing="1" fill="#00C5CC">IQ</tspan></text>
<text x="340" y="300" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="300" letter-spacing="6" fill="#2D8A94">KEEP YOUR SHOP SHARP</text>
</svg>`;

const WIDTHS = { header: 110, small: 160, medium: 220, large: 280 };

export default function InlineIQLogo({ size = 'medium' }) {
  const w = WIDTHS[size] ?? WIDTHS.medium;
  const h = Math.round(w * (340 / 680));
  return <SvgXml xml={SVG} width={w} height={h} />;
}
