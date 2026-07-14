import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconCircleInfo({ size = "24px", ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M8 22L16 22" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M18.01 20L18 20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M6.01001 20L6.00001 20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M20.01 18L20 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M4.01001 18L4.00001 18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M12 16L12 12H10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M22 8L22 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M12 8.01V8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M2 8L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M20.01 6L20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M4 6L4 6.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M18.01 4L18 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M6 4L6 4.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
      <path d="M8 2L16 2" stroke="currentColor" strokeWidth="2" strokeLinecap="square" data-color="color-2" fill="none" />
    </svg>
  );
}

export default IconCircleInfo;
