/** Minimal inline SVG icons so severity is never color-only (icon + label). */
import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  style?: CSSProperties;
  title?: string;
  className?: string;
}

function wrap(
  path: React.ReactNode,
  { size = 16, style, title, className }: IconProps,
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={className}
      style={style}
    >
      {title ? <title>{title}</title> : null}
      {path}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => wrap(<polyline points="20 6 9 17 4 12" />, p);
export const WarnIcon = (p: IconProps) =>
  wrap(
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>,
    p,
  );
export const CriticalIcon = (p: IconProps) =>
  wrap(
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>,
    p,
  );
export const InfoIcon = (p: IconProps) =>
  wrap(
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>,
    p,
  );
export const UnknownIcon = (p: IconProps) =>
  wrap(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>,
    p,
  );
export const SpinnerIcon = (p: IconProps) =>
  wrap(<path d="M21 12a9 9 0 1 1-6.219-8.56" />, { ...p });
export const RetryIcon = (p: IconProps) =>
  wrap(
    <>
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </>,
    p,
  );
export const ArrowRightIcon = (p: IconProps) =>
  wrap(
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>,
    p,
  );
export const BoltIcon = (p: IconProps) =>
  wrap(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />, p);
export const ThermometerIcon = (p: IconProps) =>
  wrap(
    <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />,
    p,
  );
