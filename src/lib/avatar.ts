// Client-side avatars (spec §2, §7.1). DiceBear renders a deterministic SVG from
// the display name + a small config blob stored on the profile — no external
// image requests. The config is intentionally style-agnostic so it can't produce
// an invalid per-style option set.
import { createAvatar } from '@dicebear/core'
import { adventurer, bigSmile, funEmoji } from '@dicebear/collection'

export type AvatarStyle = 'adventurer' | 'bigSmile' | 'funEmoji'

export interface AvatarConfig {
  style?: AvatarStyle
  seedSalt?: string // "randomize" appends a salt so the same name yields a new face
  backgroundColor?: string // hex, no leading '#'
  flip?: boolean
}

// Brand palette (spec §8), minus navy so the face never vanishes on the app bg.
export const AVATAR_BG = ['F2A93B', '1C7293', '17A2C4', '7CC243', 'E2504C', 'FFC857'] as const
export const AVATAR_STYLES: { key: AvatarStyle; label: string }[] = [
  { key: 'adventurer', label: 'Adventurer' },
  { key: 'bigSmile', label: 'Big Smile' },
  { key: 'funEmoji', label: 'Fun Emoji' },
]

/** A stable data-URI SVG for a name + config. Safe to use as an <img src>. The
 *  switch keeps each style's option type concrete (we only pass core options). */
export function avatarDataUri(displayName: string, config: AvatarConfig = {}): string {
  const opts = {
    seed: `${displayName}${config.seedSalt ?? ''}`,
    backgroundColor: [config.backgroundColor ?? 'F2A93B'],
    flip: config.flip ?? false,
    radius: 50,
  }
  switch (config.style ?? 'adventurer') {
    case 'bigSmile':
      return createAvatar(bigSmile, opts).toDataUri()
    case 'funEmoji':
      return createAvatar(funEmoji, opts).toDataUri()
    default:
      return createAvatar(adventurer, opts).toDataUri()
  }
}

/** Read a profile's loosely-typed avatar_config into our shape. */
export function toAvatarConfig(raw: Record<string, unknown> | null | undefined): AvatarConfig {
  const c = (raw ?? {}) as Record<string, unknown>
  const style = c.style
  return {
    style: style === 'bigSmile' || style === 'funEmoji' ? style : 'adventurer',
    seedSalt: typeof c.seedSalt === 'string' ? c.seedSalt : '',
    backgroundColor: typeof c.backgroundColor === 'string' ? c.backgroundColor : AVATAR_BG[0],
    flip: typeof c.flip === 'boolean' ? c.flip : false,
  }
}

/** A non-empty avatar_config marks a profile as onboarded (the builder writes one). */
export function isOnboarded(raw: Record<string, unknown> | null | undefined): boolean {
  return Boolean(raw) && Object.keys(raw as object).length > 0
}
