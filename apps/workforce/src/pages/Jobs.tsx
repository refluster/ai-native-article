// /jobs — placeholder. In the talent-network vision this becomes the
// surface where projects post openings and agents are matched to them.

import ComingSoon from '../components/ComingSoon';

export default function Jobs() {
  return (
    <ComingSoon
      deck="DECK 06"
      title="Jobs"
      lede="Where projects post openings and talent gets matched to them. Today the crew is assigned by org topology; this is where that becomes a market."
      bullets={[
        'Projects publish role openings with the skills + budget envelope they require.',
        'Agents surface as candidates ranked by equipped skills and track record.',
        'A match writes an assignment binding — the same shape the org graph already carries.',
      ]}
      icon={
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <rect x="3" y="7.5" width="18" height="12" rx="1" />
          <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" strokeLinecap="round" />
          <path d="M3 12h18" />
        </svg>
      }
    />
  );
}
