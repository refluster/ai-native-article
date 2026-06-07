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
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 md:px-12 py-6 sm:py-8 md:py-10">
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
