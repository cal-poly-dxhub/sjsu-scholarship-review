import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconTriangleWarning({ size = "24px", ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M4 21H20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M22 17L22 19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M12 17H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M2 17L2 19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M20 13L20 15" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M4 13L4 15" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M18 9L18 11" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M12 13V9" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M6 9L6 11" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M16 5L16 7" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M8 5L8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M10 3H14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
    </svg>
  );
}

export default IconTriangleWarning;
