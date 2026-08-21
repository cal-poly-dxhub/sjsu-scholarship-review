import React from 'react';
import type { SVGProps } from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconLock({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}>
{/* paths grouped shackle/body so consumers can animate them (see .lock-rattle in sjsu.css) */}
<g className="lock-shackle">
<path d="M16 4V10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M8 10V4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M10 2H14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
</g>
<g className="lock-body">
<path d="M12 15V16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M5 21H19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M3 12V19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M21 12V19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M5 10H19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
</g>
</svg>
  );
};

export default IconLock;