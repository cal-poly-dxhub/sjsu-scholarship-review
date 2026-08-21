import React from 'react';
import type { SVGProps } from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconWindowLeft({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M20 20L4 20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M8 16L8 16.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M10 14L10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M6 14L6 10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M8 8.00001L8 8.01001" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M22 6L22 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M2 6L2 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M20 4L4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path></svg>
  );
};

export default IconWindowLeft;