export type ParticipantColor = 1 | 2 | 3 | 4 | 5;

/**
 * The participant colour pair (`--pN-bg` / `--pN-fg`) for an identity: the
 * same person gets the same colour on every screen and every reload.
 */
export function participantColor(identity: string): ParticipantColor {
  // FNV-1a: cheap, and spreads short similar names apart.
  let hash = 0x811c9dc5;
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (((hash >>> 0) % 5) + 1) as ParticipantColor;
}

/** One or two letters for someone shown without video: first and last word. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? '')[0] ?? '';
  const last = words.length > 1 ? (Array.from(words.at(-1) ?? '')[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}
