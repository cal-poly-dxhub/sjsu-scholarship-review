import React from 'react';
import type { SVGProps } from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconTileToRight({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M4 20L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M15.99 16L16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M2 16L2 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M9.98999 12H9.99999" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M4 12L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M18 10L18 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M14 10L14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M15.99 8L16 8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M6 8L6 10H8L8 14H6L6 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M22 6L22 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M2 6L2 8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M4 4L20 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path></svg>
  );
};

export default IconTileToRight;