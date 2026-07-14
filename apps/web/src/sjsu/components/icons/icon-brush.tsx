import React, {SVGProps} from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconBrush({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M10 6H10.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M8 8H8.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M6 15V10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M9 18L14 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M10 10H10.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M12 12H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M14 14H14.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M7 20H7.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M4 17H4.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M16 16H16.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M12 4H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M14 2H14.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M18 14H18.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M20 12H20.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M22 10H22.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M20 8H20.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M18 6H16L16 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M2 19V20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M5 22L4 22" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path></svg>
  );
};

export default IconBrush;