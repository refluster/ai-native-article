// Sub-navigation strip pinned beneath the global Header on every
// /workforce/* route. The strip itself styles like a console subheading
// (mono caps + active underline in the wf-tertiary accent).

import { NavLink } from 'react-router-dom';

const links = [
  { to: '/',        label: 'DASHBOARD', end: true  },
  { to: '/agents',  label: 'CREW',      end: false },
  { to: '/skills',  label: 'SKILLS',    end: false },
  { to: '/org',     label: 'ORG',       end: false },
  { to: '/feed',    label: 'FEED',      end: false },
];

interface Props {
  /** Optional right-side slot — e.g. system status indicator. */
  right?: React.ReactNode;
}

export default function WorkforceSubnav({ right }: Props) {
  return (
    <div className="border-b border-wf-outline-variant bg-wf-surface-container-lo">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 md:px-12 h-10 flex items-center gap-6">
        <nav className="flex items-center gap-5">
          {links.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `font-wfmono text-[11px] uppercase tracking-[0.14em] py-2.5 border-b-2 transition-colors ${
                  isActive
                    ? 'border-wf-tertiary text-wf-on-surface'
                    : 'border-transparent text-wf-on-surface-variant hover:text-wf-on-surface'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto">{right}</div>
      </div>
    </div>
  );
}
