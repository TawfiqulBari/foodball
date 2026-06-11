import { AVATAR_BG, AVATAR_STYLES, type AvatarConfig } from '../lib/avatar'
import { Avatar } from './Avatar'

/** The avatar customiser (spec §7.1): live preview + randomize + option rows.
 *  Controlled — the parent owns the config and persists it. */
export function AvatarBuilder({
  name,
  config,
  onChange,
}: {
  name: string
  config: AvatarConfig
  onChange: (next: AvatarConfig) => void
}) {
  const set = (patch: Partial<AvatarConfig>) => onChange({ ...config, ...patch })

  return (
    <div className="rounded-card bg-white text-ink shadow-sm ring-1 ring-ink/10 p-4">
      <div className="flex flex-col items-center">
        <Avatar name={name || 'Chef'} config={config as Record<string, unknown>} size={112} />
        <button
          type="button"
          onClick={() => set({ seedSalt: `${Date.now()}` })}
          className="mt-3 min-h-tap rounded-full bg-orange px-5 font-display text-white active:scale-95"
        >
          🎲 Randomize
        </button>
      </div>

      <Row label="Style">
        {AVATAR_STYLES.map((s) => (
          <Chip key={s.key} active={config.style === s.key} onClick={() => set({ style: s.key })}>
            {s.label}
          </Chip>
        ))}
      </Row>

      <Row label="Background">
        {AVATAR_BG.map((bg) => (
          <button
            key={bg}
            type="button"
            aria-label={`background ${bg}`}
            onClick={() => set({ backgroundColor: bg })}
            className={`h-8 w-8 rounded-full border-2 transition active:scale-95 ${
              config.backgroundColor === bg ? 'border-ink' : 'border-transparent'
            }`}
            style={{ backgroundColor: `#${bg}` }}
          />
        ))}
      </Row>

      <Row label="Mirror">
        <Chip active={!config.flip} onClick={() => set({ flip: false })}>
          Normal
        </Chip>
        <Chip active={Boolean(config.flip)} onClick={() => set({ flip: true })}>
          Flipped
        </Chip>
      </Row>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/50">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-tap rounded-full px-4 text-sm font-display transition active:scale-95 ${
        active ? 'bg-orange text-white' : 'bg-ink/5 text-ink hover:bg-ink/10'
      }`}
    >
      {children}
    </button>
  )
}
