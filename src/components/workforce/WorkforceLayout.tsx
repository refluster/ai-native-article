// Page-level chrome shared by every /workforce/* screen. Wraps the
// route content in the .workforce-section class (so the page background
// repaints to wf-surface) and pins the Subnav under the global Header.

import { type ReactNode } from 'react';
import WorkforceSubnav from './WorkforceSubnav';

interface Props {
  children: ReactNode;
  /** Optional content rendered at the right edge of the subnav strip. */
  subnavRight?: ReactNode;
}

export default function WorkforceLayout({ children, subnavRight }: Props) {
  return (
    <div className="workforce-section min-h-[calc(100vh-4rem)]">
      <WorkforceSubnav right={subnavRight} />
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 md:px-12 py-6 sm:py-8 md:py-10">
        {children}
      </div>
    </div>
  );
}
