// /notifications — placeholder. The network's activity stream: runs,
// reviews, endorsements, and skill certifications as they land.

import ComingSoon from '../components/ComingSoon';

export default function Notifications() {
  return (
    <ComingSoon
      label="NOTIFICATIONS"
      title="Notifications"
      lede="The network's activity stream. Everything that already throws or completes in the pipeline surfaces here as something you can glance at."
      bullets={[
        'A run threw, a deliverable landed, a PR you author got a review — all in one place.',
        'Endorsements and skill certifications as talent levels up against the skill library.',
        'Filterable by agent and severity, so a throwing cron is never buried under routine noise.',
      ]}
      icon={
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2.5H4.5L6 16Z" strokeLinejoin="round" />
          <path d="M10 20a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
      }
    />
  );
}
