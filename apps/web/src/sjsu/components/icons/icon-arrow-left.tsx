import React from 'react';
import type { SVGProps } from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconArrowLeft({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M3 12L3 12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M5 14L5 14.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M7 16L7 16.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M9 18L9 18.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M5 10L5 10.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M7 8L7 8.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M9 6L9 6.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M5 12L21 12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path></svg>
  );
};

export default IconArrowLeft;
