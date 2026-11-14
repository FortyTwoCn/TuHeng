import { useId } from 'react';

export function LoginProjection() {
  const id = useId();
  return (
    <svg className="projection-art" viewBox="0 0 448 370" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-v`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#9acfe8" stopOpacity="0.15" />
          <stop offset="1" stopColor="#9acfe8" stopOpacity="0.03" />
        </linearGradient>
        <linearGradient id={`${id}-w`} x1="1" y1="0" x2="0" y2="1">
          <stop stopColor="#8bbad8" stopOpacity="0.1" />
          <stop offset="1" stopColor="#8bbad8" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id={`${id}-h`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#55c5bd" stopOpacity="0.04" />
          <stop offset="1" stopColor="#55c5bd" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      {/* V and W stand vertically above the shared origin; H is the horizontal floor. */}
      <g strokeWidth="1" strokeLinejoin="round">
        <path
          data-plane="V"
          d="M224 182 74 260V118L224 40Z"
          fill={`url(#${id}-v)`}
          stroke="#8eb9cf"
          strokeOpacity="0.45"
        />
        <path
          data-plane="W"
          d="M224 182 374 260V118L224 40Z"
          fill={`url(#${id}-w)`}
          stroke="#8eb9cf"
          strokeOpacity="0.35"
        />
        <path
          data-plane="H"
          d="M224 182 74 260 224 338 374 260Z"
          fill={`url(#${id}-h)`}
          stroke="#6dbebc"
          strokeOpacity="0.5"
        />
      </g>
      <g fill="none" stroke="#a2c9d7" strokeWidth="0.65" strokeOpacity="0.13">
        <path d="M124 92V234M174 66V208M74 166 224 88M74 212 224 134" />
        <path d="M274 66V208M324 92V234M224 88 374 166M224 134 374 212" />
        <path d="M124 234 274 312M174 208 324 286M274 208 124 286M324 234 174 312" />
      </g>
      <path
        d="M74 260 224 182 374 260M224 182V40"
        fill="none"
        stroke="#b6d6df"
        strokeOpacity="0.6"
        strokeWidth="1.3"
      />
      <g fill="#a8c7d4" fontSize="12" fontStyle="italic" textAnchor="middle" opacity="0.65">
        <text x="57" y="272">
          x
        </text>
        <text x="391" y="272">
          y
        </text>
        <text x="224" y="25">
          z
        </text>
        <text x="233" y="180" fontSize="10">
          O
        </text>
      </g>
      {/* One spatial point and its three orthogonal projections, in the same affine view. */}
      <path
        d="M123.5 153.32 165.5 175.16 266 122.9M165.5 175.16V256.1"
        fill="none"
        stroke="#80d5cd"
        strokeWidth="1.2"
        strokeDasharray="4 5"
        strokeOpacity="0.75"
      />
      <g fill="#b7dedc">
        <circle cx="123.5" cy="153.32" r="2.5" />
        <circle cx="266" cy="122.9" r="2.5" />
        <circle cx="165.5" cy="256.1" r="2.5" />
      </g>
      <circle cx="165.5" cy="175.16" r="10" fill="#71d0c7" fillOpacity="0.1" />
      <circle cx="165.5" cy="175.16" r="4" fill="#a0e7dc" />
      <text x="178" y="168" fill="#b3e6e0" fontSize="13">
        A
      </text>
      <g fontSize="21" fontWeight="500" textAnchor="middle" letterSpacing="1">
        <text data-plane-label="V" x="122" y="205" fill="#b0cddc">
          V
        </text>
        <text data-plane-label="W" x="324" y="205" fill="#91b4c9">
          W
        </text>
        <text data-plane-label="H" x="240" y="296" fill="#8ed2cb">
          H
        </text>
      </g>
    </svg>
  );
}
