// DiceBear avataaars URL builder — shared by the workforce console
// (Sigil) and the article byline chip (AgentAvatar) so the same persona
// shows the same face on every page.
//
// We pin the major version (9.x) and the style (avataaars) deliberately;
// changing either would alter every existing portrait. The seed is the
// agent slug, which is stable across the pipeline. A small palette of
// pastel backgrounds is passed in so DiceBear deterministically picks one
// per seed — gives variety without us computing colors per persona.
//
// Reference: https://www.dicebear.com/styles/avataaars/

const BASE = 'https://api.dicebear.com/9.x/avataaars/svg';

// Pastel-tinted backgrounds — hex without `#` (DiceBear URL format, also
// keeps lint:tokens happy since the regex only flags `#rrggbb`).
const BG_PALETTE = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf'];

export function dicebearAvatarUrl(slug: string, size?: number): string {
  const seed = encodeURIComponent(slug || 'anonymous');
  const params = new URLSearchParams();
  params.set('seed', seed);
  params.set('backgroundColor', BG_PALETTE.join(','));
  if (size && Number.isFinite(size)) {
    params.set('size', String(Math.round(size)));
  }
  return `${BASE}?${params.toString()}`;
}
