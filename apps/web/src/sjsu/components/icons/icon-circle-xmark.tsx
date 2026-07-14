import React, {SVGProps} from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconCircleXmark({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M8 22L16 22" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M18.01 20L18 20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M6.01001 20L6.00001 20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M20.01 18L20 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M4.01001 18L4.00001 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M16.01 16L16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M8.01001 16L8.00001 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M14.01 14L14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M10.01 14L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M12.01 12L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M14.01 10L14 10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M10.01 10L10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M22 8L22 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M16.01 8L16 8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M8.01001 8L8.00001 8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M2 8L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M20.01 6L20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M4 6L4 6.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M18.01 4L18 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M6 4L6 4.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M8 2L16 2" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path></svg>
  );
};

export default IconCircleXmark;