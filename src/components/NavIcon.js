import React from 'react';
import Svg, { Path, Polyline, Line, Rect } from 'react-native-svg';

const SIZE = 22;
const SW = 1.6;
const COMMON = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: SW };

export function HomeIcon({ color }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24">
      <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke={color} {...COMMON} />
      <Polyline points="9,22 9,12 15,12 15,22" stroke={color} {...COMMON} />
    </Svg>
  );
}

export function MessagesIcon({ color }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24">
      <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke={color} {...COMMON} />
    </Svg>
  );
}

export function InventoryIcon({ color }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24">
      <Path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke={color} {...COMMON} />
    </Svg>
  );
}

export function DamageIcon({ color }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24">
      <Path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke={color} {...COMMON} />
      <Line x1="12" y1="9" x2="12" y2="13" stroke={color} {...COMMON} />
      <Line x1="12" y1="17" x2="12.01" y2="17" stroke={color} {...COMMON} />
    </Svg>
  );
}

export function MoreIcon({ color }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24">
      <Rect x="3" y="3" width="7" height="7" stroke={color} {...COMMON} />
      <Rect x="14" y="3" width="7" height="7" stroke={color} {...COMMON} />
      <Rect x="14" y="14" width="7" height="7" stroke={color} {...COMMON} />
      <Rect x="3" y="14" width="7" height="7" stroke={color} {...COMMON} />
    </Svg>
  );
}

// Larger variants for More drawer tiles (28px)
const TILE = 28;
const TILE_COMMON = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: SW };

export function ScanIcon({ color }) {
  return (
    <Svg width={TILE} height={TILE} viewBox="0 0 24 24">
      <Path d="M3 8V6a2 2 0 0 1 2-2h2" stroke={color} {...TILE_COMMON} />
      <Path d="M21 8V6a2 2 0 0 0-2-2h-2" stroke={color} {...TILE_COMMON} />
      <Path d="M3 16v2a2 2 0 0 0 2 2h2" stroke={color} {...TILE_COMMON} />
      <Path d="M21 16v2a2 2 0 0 1-2 2h-2" stroke={color} {...TILE_COMMON} />
      <Line x1="7" y1="12" x2="17" y2="12" stroke={color} {...TILE_COMMON} />
    </Svg>
  );
}

export function BookIcon({ color }) {
  return (
    <Svg width={TILE} height={TILE} viewBox="0 0 24 24">
      <Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke={color} {...TILE_COMMON} />
      <Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke={color} {...TILE_COMMON} />
    </Svg>
  );
}

export function DocumentIcon({ color }) {
  return (
    <Svg width={TILE} height={TILE} viewBox="0 0 24 24">
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={color} {...TILE_COMMON} />
      <Polyline points="14,2 14,8 20,8" stroke={color} {...TILE_COMMON} />
      <Line x1="16" y1="13" x2="8" y2="13" stroke={color} {...TILE_COMMON} />
      <Line x1="16" y1="17" x2="8" y2="17" stroke={color} {...TILE_COMMON} />
    </Svg>
  );
}
