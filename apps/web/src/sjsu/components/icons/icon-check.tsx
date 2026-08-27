import React from 'react';
import type { SVGProps } from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconCheck({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M9.99999 18H10.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M7.99999 16H8.00999" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M14 14H14.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M5.99999 14H6.00999" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M3.99999 12H4.00999" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M22 6H22.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M16 12H16.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M18 10H18.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M20 8H20.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path></svg>
  );
};

export default IconCheck;