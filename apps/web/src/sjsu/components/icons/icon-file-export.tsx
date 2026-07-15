import React, {SVGProps} from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconFileExport({size = '24px', ...props}: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width={size} height={size} viewBox="0 0 24 24" {...props}><path d="M10 11H14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M12 9L12 18" stroke="currentColor" strokeWidth="2" stroke-miterlimit="10" strokeLinecap="square" fill="none"></path>
<path d="M6 22L18 22" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M10 2L18 2" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M20 20L20 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M4 20L4 8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M8.01001 4H8.00001" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M6.01001 6H6.00001" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none"></path>
<path d="M8.005 13.005L8.005 12.995" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path>
<path d="M16.005 13.005L16.005 12.995" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"></path></svg>
  );
};

export default IconFileExport;