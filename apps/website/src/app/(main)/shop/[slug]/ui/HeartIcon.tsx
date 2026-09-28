type HeartIconProps = {
  filled: boolean;
  className?: string;
};

// Inline SVG so no icon library is needed. Decorative: the button or panel
// around it carries the accessible name. `data-filled` lets tests assert the
// state without inspecting paths.
export function HeartIcon({ filled, className }: HeartIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      data-filled={filled}
      className={className}
    >
      <path
        d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4 7.4 4c2 0 3.6 1.1 4.6 2.7C13 5.1 14.6 4 16.6 4c3.5 0 5.8 3.6 4.6 7.1-1.7 4.8-9.2 9.4-9.2 9.4Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
