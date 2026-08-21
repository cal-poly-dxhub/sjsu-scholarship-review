import React from 'react';
import type { SVGProps } from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconXmark({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}>
<rect width="2" height="2" transform="matrix(-1 0 0 1 13 11)" fill="currentColor"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 11 9)" fill="currentColor"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 15 13)" fill="currentColor"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 15 9)" fill="currentColor" data-color="color-2"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 11 13)" fill="currentColor" data-color="color-2"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 9 15)" fill="currentColor" data-color="color-2"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 7 17)" fill="currentColor" data-color="color-2"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 5 19)" fill="currentColor" data-color="color-2"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 17 7)" fill="currentColor" data-color="color-2"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 19 5)" fill="currentColor" data-color="color-2"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 21 3)" fill="currentColor" data-color="color-2"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 19 17)" fill="currentColor"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 17 15)" fill="currentColor"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 21 19)" fill="currentColor"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 9 7)" fill="currentColor"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 7 5)" fill="currentColor"></rect>
<rect width="2" height="2" transform="matrix(-1 0 0 1 5 3)" fill="currentColor"></rect>
</svg>
  );
};

export default IconXmark;