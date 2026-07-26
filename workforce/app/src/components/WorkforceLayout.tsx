// Page-level chrome shared by every workforce console route. Renders the
// LinkedIn-style GlobalNav, then the routed content inside the max-width
// container.

import { type ReactNode } from 'react';
import GlobalNav from './GlobalNav';

interface Props {
  children: ReactNode;
  /** Optional content rendered in the thin strip under the global nav. */
  subnavRight?: ReactNode;
  /** When false, drops the default container padding/max-width so a page
   *  can own its own full-bleed layout (e.g. the 3-pane feed). */
  contained?: boolean;
}

export default function WorkforceLayout({ children, subnavRight, contained = true }: Props) {
  return (
    <div className="workforce-section min-h-screen">
      <GlobalNav right={subnavRight} />
      {contained ? (
        // The phone gutter is 0.75rem (px-3), matched exactly by the
        // `wf-bleed-x` utility: a card that opts into full-bleed cancels
        // this padding and spans the viewport, while prose and controls keep
        // their breathing room. It used to be px-4, which cost ~8% of a
        // 390px viewport to margin on every page.
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 md:px-12 py-5 sm:py-8 md:py-10">
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
