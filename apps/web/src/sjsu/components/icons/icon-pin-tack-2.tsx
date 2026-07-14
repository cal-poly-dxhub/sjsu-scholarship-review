import React, {SVGProps} from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconPinTack2({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M18.01 4L18 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M20.01 6L20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M22.01 8L22 8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M16.01 2L16 2" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M14.01 4L14 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M20.01 10L20 10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M18.01 12L18 12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M4.01001 10L4.00001 10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M6.01001 12L6.00001 12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M12.01 18L12 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M7.01001 17L7.00001 17" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M8.01001 14L8.00001 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M10.01 16L10 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M5.01001 19L5.00001 19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M3.01001 21L3.00001 21" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M14.01 20L14 20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M12.01 6L12 6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M10 8H6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M16 14L16 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path></svg>
  );
};

export default IconPinTack2;