import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconFolder({ size = "24px", ...props }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" {...props}>
      <path d="M20 7H14" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" fill="none" />
      <path d="M12 5H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M4 20H20" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" fill="none" />
      <path d="M4 3H10" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" fill="none" />
      <path d="M2 18L2 5" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" fill="none" />
      <path d="M22 18L22 9" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="square" fill="none" />
    </svg>
  );
}

export default IconFolder;
