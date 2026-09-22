/**
 * The active/inactive appearance of a tab, in one place.
 *
 * The booking page's tabs are `<Link>`s (they navigate between `/booking/room1`
 * and `/booking/room2`). The blog widget's room switcher is `<button>`s (it
 * toggles which prerendered panel is on screen and navigates nowhere). They
 * are deliberately different elements, so this is what keeps them from
 * drifting apart visually.
 */
export function tabStateClasses(isActive: boolean): string {
  return isActive ? "bg-[#d9b98b] text-secondary" : "text-secondary";
}
