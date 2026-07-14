import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string;
}

function IconAddMagic({ size = "24px", ...props }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" {...props}>
      <path d="M18 4H20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M18 10H20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M22 6L22 8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M16 6L16 8" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M4 8V8.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M4 4V4.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M2 6V6.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M6 6V6.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M7 16V16.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M13 14V14.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M20 20V20.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M9 14V14.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M9 18V18.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M13 18V18.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M15 16V16.01" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M11 12V10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M11 20V22" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none" />
    </svg>
  );
}

export default IconAddMagic;
