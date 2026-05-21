// Shared icon set for the Side Panel (Lucide MIT, inlined to keep the
// bundle small). Every icon takes `size` so the same component can be
// reused at 14px in a chip and 22px in the sidebar.

import type { JSX, SVGProps } from "react";

type IconProps = { size?: number } & Omit<
  SVGProps<SVGSVGElement>,
  "width" | "height" | "viewBox"
>;

const base = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const svg = ({ size = 16, ...rest }: IconProps): SVGProps<SVGSVGElement> => ({
  ...base,
  width: size,
  height: size,
  ...rest,
});

export function DropIcon({ size = 14, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...rest}
    >
      <path d="M12 4.88C13.13 6.94 16.13 9 16.13 11.44A5.25 5.25 0 1 1 7.88 11.44C7.88 9 10.88 6.94 12 4.88Z" />
    </svg>
  );
}

export function SparkleIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg({ size: 14, ...p })}>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  );
}

export function GearIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ReplyIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

export function TranslateIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
}

export function GrammarIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="m6 16 6-12 6 12" />
      <path d="M8 12h8" />
      <path d="m16 20 2 2 4-4" />
    </svg>
  );
}

export function RewriteIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function SlidersIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <circle cx="14" cy="4" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="16" cy="20" r="2" />
    </svg>
  );
}

export function ChevronDownIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronLeftIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ArrowRightIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function CopyIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function CheckIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function SquareIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <rect width="14" height="14" x="5" y="5" rx="1.5" />
    </svg>
  );
}

export function XIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function ExternalLinkIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function HistoryIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function TrashIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function SearchIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function MenuIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <line x1="3" x2="21" y1="6" y2="6" />
      <line x1="3" x2="21" y1="12" y2="12" />
      <line x1="3" x2="21" y1="18" y2="18" />
    </svg>
  );
}

export function SendIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export function PlusIcon(p: IconProps): JSX.Element {
  return (
    <svg {...svg(p)}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

