import React, {SVGProps} from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconLayers2({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M12.01 20L12 20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M16 18L14 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M10 18L8 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M20 16L18 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M12.01 16L12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M6 16L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M22.01 14L22 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M16 14L14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M10 14L8 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M2.01001 14L2.00001 14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M20 12L18 12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M6 12L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M22.01 10L22 10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M2.01001 10L2.00001 10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M20 8L18 8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M6 8L4 8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M16 6L14 6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M10 6L8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M12.01 4L12 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path></svg>
  );
};

export default IconLayers2;