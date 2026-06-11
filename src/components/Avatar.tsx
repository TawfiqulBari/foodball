import { useMemo } from 'react'
import { avatarDataUri, toAvatarConfig } from '../lib/avatar'

/** Renders a player's DiceBear avatar from their name + stored config. */
export function Avatar({
  name,
  config,
  size = 40,
  className = '',
}: {
  name: string
  config?: Record<string, unknown> | null
  size?: number
  className?: string
}) {
  const uri = useMemo(() => avatarDataUri(name, toAvatarConfig(config)), [name, config])
  return (
    <img
      src={uri}
      alt=""
      width={size}
      height={size}
      className={`rounded-full bg-muted ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
