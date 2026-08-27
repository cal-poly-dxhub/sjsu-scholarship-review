import React from 'react';
import type { SVGProps } from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconLayers({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M13 21L11 21" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M16 19L15 19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M9 19L8 19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M19 17L18 17" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M6 17L5 17" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M22 15L21 15" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M13 15L11 15" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M3 15L2 15" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M16 13L15 13" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M9 13L8 13" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M19 11L18 11" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M6 11L5 11" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M22 9L21 9" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M3 9L2 9" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M19 7L18 7" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M6 7L5 7" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M16 5L15 5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M9 5L8 5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M13 3L11 3" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path></svg>
  );
};

export default IconLayers;