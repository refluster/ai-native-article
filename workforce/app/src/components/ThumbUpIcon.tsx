/** The like button's glyph (boards + feed). An inline SVG rather than the
 *  👍 emoji: emoji rendering (colour, boldness) varies too much across
 *  platforms to read reliably as "filled vs. outline" at 14px; a
 *  stroke/fill swap does not. `filled` = pressed, outline = un-pressed. */
export default function ThumbUpIcon({ filled, size = 13 }: { filled: boolean; size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M7 8.5 10.2 2.8c.9 0 1.8.8 1.8 2v2.7h4a1.6 1.6 0 0 1 1.55 1.95l-1.4 6A1.6 1.6 0 0 1 14.7 16.7H7Z" />
      <path d="M7 8.5v8.2H4.4A1.4 1.4 0 0 1 3 15.3V9.9a1.4 1.4 0 0 1 1.4-1.4Z" />
    </svg>
  );
}
