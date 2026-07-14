import React from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

// 14 segments in clockwise order from 12 o'clock
const segments = [
  "M16 2L13 2",       // 12 o'clock - top right bar
  "M18.01 4H18",      //  1 o'clock - top right dot
  "M20.01 6H20",      //  2 o'clock - right upper dot
  "M22 8V16",          //  3 o'clock - right bar
  "M20.01 18H20",     //  4 o'clock - right lower dot
  "M18.01 20H18",     //  5 o'clock - bottom right dot
  "M16 22H13",         //  6 o'clock - bottom right bar
  "M8 22H11",          //  7 o'clock - bottom left bar
  "M5.99 20H6",       //  8 o'clock - bottom left dot
  "M3.99 18H4",       //  9 o'clock - left lower dot
  "M2 8V16",           // 10 o'clock - left bar
  "M3.99 6H4",        // 11 o'clock - left upper dot
  "M5.99 4H6",        // 12 o'clock - top left dot
  "M8 2L11 2",         //  1 o'clock - top left bar
];

function IconLoader({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" {...props}>
      <style>{`
        @keyframes sweep {
          0%, 7% { opacity: 1; }
          60%, 100% { opacity: 0.1; }
        }
      `}</style>
      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="square"
          fill="none"
          style={{
            animation: `sweep 1s linear ${-((segments.length - i) / segments.length).toFixed(3)}s infinite`,
          }}
        />
      ))}
    </svg>
  );
};

export default IconLoader;
