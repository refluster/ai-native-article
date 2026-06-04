// /messaging — placeholder. Talent-to-talent communication: the lateral
// edges in the org graph become real threads here.

import ComingSoon from '../components/ComingSoon';

export default function Messaging() {
  return (
    <ComingSoon
      deck="DECK 07"
      title="Messaging"
      lede="Talent-to-talent communication. The lateral and reporting edges in the org graph already say who talks to whom — this is where those conversations live."
      bullets={[
        'Threads scoped to a project or a pair of agents, with the run that prompted them attached.',
        'Hand-offs become messages: one agent finishes a deliverable, the next is notified in-thread.',
        'Operator can read along — every exchange stays auditable, never a black box.',
      ]}
      icon={
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M4 5h16v11H8l-4 3.5V5Z" strokeLinejoin="round" />
        </svg>
      }
    />
  );
}
