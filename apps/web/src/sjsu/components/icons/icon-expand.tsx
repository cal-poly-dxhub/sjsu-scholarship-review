import React from 'react';
import type { SVGProps } from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconExpand({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M21 16L21 19" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" fill="none"></path>
<path d="M16 21L19 21" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" fill="none"></path>
<path d="M8 3L5 3" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" fill="none"></path>
<path d="M3 8L3 5" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" fill="none"></path>
<path d="M16 3L19 3" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M21 8L21 5" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M3 16L3 19" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M8 21L5 21" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" data-color="color-2" fill="none"></path></svg>
  );
};

export default IconExpand;