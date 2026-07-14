import React from "react";

// macOS-style pointer (white outline + black body), ported from the
// seller-radar onboarding cursor. fixed two-tone fill, not currentColor.
function IconCursor({ width = 22, height = 34, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 618 958"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <g filter="url(#cursor_shadow)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M127.062 37.0331L540.696 451.555C592.653 503.66 555.794 592.574 482.226 592.574L421.831 592.569L481.821 735.054C492.331 760.021 492.479 787.652 482.265 812.767C472.002 837.932 452.561 857.57 427.496 868.08C414.864 873.359 401.64 876.024 388.121 876.024C347.117 876.024 310.358 851.6 294.47 813.804L231.42 663.918L190.368 700.337C137.029 747.508 53 709.663 53 638.413V67.6744C53 28.9903 99.7268 9.64828 127.062 37.0331Z"
          fill="white"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M102.316 99.652C102.316 93.1882 110.162 89.9316 114.701 94.5204L504.897 485.555C526.164 506.871 511.065 543.236 480.967 543.236L347.546 543.161L436.342 754.143C447.542 780.788 435.009 811.429 408.414 822.581C381.72 833.781 351.128 821.298 339.977 794.702L250.293 581.352L158.517 662.644C137.991 680.801 106.319 668.145 102.664 642.323L102.316 637.331V99.652Z"
          fill="black"
        />
      </g>
      <defs>
        <filter
          id="cursor_shadow"
          x="0.34"
          y="0.799219"
          width="617.32"
          height="957.144"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="29.26" />
          <feGaussianBlur stdDeviation="26.33" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.65 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
        </filter>
      </defs>
    </svg>
  );
}

export default IconCursor;
