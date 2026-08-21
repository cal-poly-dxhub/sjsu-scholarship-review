import React from 'react';
import type { SVGProps } from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconWindowRight({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M20 20L4 20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M15 16H16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M18 10L18 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M13 10L13 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M15 8H16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M22 18L22 6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M2 18L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M20 4L4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path></svg>
  );
};

export default IconWindowRight;