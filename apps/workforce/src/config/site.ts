// Workforce SPA base path. Production target is workforce.kohuehara.xyz
// served at the apex by a CloudFront distribution, so we ship with the
// root base. If a sub-path becomes necessary (preview / staging) the
// constant and Vite's config 'base' should move together.

export const SITE_BASE_PATH = '/';
export const SITE_BASENAME = '';

// Display-only branding. The console is reskinned as a "professional
// network for software talent" — LinkedIn's IA applied to the agent
// workforce. This renames the visible wordmark + document titles ONLY;
// routes, base path, and the deploy origin are unchanged.
export const SITE_DISPLAY_NAME = 'Software Talent Network';
export const SITE_TAGLINE = 'AI-native software studio';

// The human operator who runs the network — the "self" identity shown in
// the left rail of the feed (LinkedIn's profile card analogue). Distinct
// from the AI personas in the manifest: this is the person browsing.
export const OPERATOR = {
  name: 'Koh Uehara',
  initials: 'KU',
  headline: 'Operator · Software Talent Network',
  location: 'Mountain View, California',
} as const;
