import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, LayoutGrid, Image, Film, Music, FileText, Sparkles, Package, Boxes } from 'lucide-react'
import { cn } from '../lib/utils'
import { AI_TAGS, AI_TAG_CATEGORIES } from '../lib/aiTags'

const EXT_OPTIONS = [
  { key: '',          label: 'All Types',  Icon: LayoutGrid },
  { key: 'images',   label: 'Images',     Icon: Image },
  { key: 'videos',   label: 'Videos',     Icon: Film },
  { key: 'audio',    label: 'Audio',      Icon: Music },
  { key: 'documents',label: 'Documents',  Icon: FileText },
]

// ─── Reusable chip with dropdown ─────────────────────────────────────────────

function FilterChip({ label, activeLabel, icon: Icon, onClear, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const isActive = !!activeLabel

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all select-none whitespace-nowrap',
          isActive
            ? 'bg-[var(--primary)]/15 text-[var(--primary)] border-[var(--primary)]/30'
            : 'bg-white/[0.04] text-[var(--muted-foreground)] border-white/10 hover:bg-white/[0.08] hover:text-[var(--foreground)]'
        )}
      >
        {Icon && <Icon size={11} />}
        {isActive ? activeLabel : label}
        {isActive
          ? <X size={9} className="ml-0.5 opacity-60 hover:opacity-100"
              onClick={e => { e.stopPropagation(); onClear?.() }} />
          : <ChevronDown size={9} className="ml-0.5 opacity-50" />
        }
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  )
}

// ─── Main FilterBar ───────────────────────────────────────────────────────────

export function FilterBar({
  mode = 'raw',
  extFilter, onExtFilter,
  selectedContentType, onSelectContentType,
  containers, selectedContainer, onSelectContainer,
  selectedAiTags, onToggleAiTag,
  activeCount, onClear,
}) {
  const isRaw = mode === 'raw'
  const products = containers?.products || []
  const bundles  = containers?.bundles  || []

  const activeExtLabel  = EXT_OPTIONS.find(o => o.key === extFilter && o.key !== '')?.label
  const ActiveExtIcon   = EXT_OPTIONS.find(o => o.key === extFilter)?.Icon || LayoutGrid
  const activeTagCount  = selectedAiTags.length
  const activeContentLabel = selectedContentType
    ? ({ real: 'Real', ai: 'AI', cta: 'CTA' }[selectedContentType]) : null

  // Combine products + bundles for the Product chip dropdown
  const hasContainers = isRaw && (products.length > 0 || bundles.length > 0)

  return (
    <div className="flex items-center gap-2 flex-wrap">

      {/* File Type */}
      <FilterChip
        label="Type"
        activeLabel={activeExtLabel}
        icon={ActiveExtIcon}
        onClear={() => onExtFilter('')}
      >
        {({ close }) => (
          <div className="p-1.5" style={{ minWidth: 160 }}>
            {EXT_OPTIONS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => { onExtFilter(key); close() }}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs text-left transition-colors',
                  extFilter === key
                    ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                    : 'text-[var(--foreground)] hover:bg-white/5'
                )}
              >
                <Icon size={12} className="opacity-60" />
                {label}
              </button>
            ))}
          </div>
        )}
      </FilterChip>

      {/* Content Type — Raw only */}
      {isRaw && (
        <FilterChip
          label="Content"
          activeLabel={activeContentLabel}
          icon={null}
          onClear={() => onSelectContentType(null)}
        >
          {({ close }) => (
            <div className="p-1.5" style={{ minWidth: 140 }}>
              {[['real', 'Real'], ['ai', 'AI'], ['cta', 'CTA']].map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => { onSelectContentType(selectedContentType === val ? null : val); close() }}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs text-left transition-colors',
                    selectedContentType === val
                      ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                      : 'text-[var(--foreground)] hover:bg-white/5'
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
          )}
        </FilterChip>
      )}

      {/* Products + Bundles — Raw only */}
      {hasContainers && (
        <FilterChip
          label="Product"
          activeLabel={selectedContainer}
          icon={Package}
          onClear={() => onSelectContainer(null)}
        >
          {({ close }) => (
            <div className="p-1.5 max-h-64 overflow-y-auto" style={{ minWidth: 180 }}>
              {products.length > 0 && (
                <>
                  <p className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
                    Products
                  </p>
                  {products.map(name => (
                    <button
                      key={name}
                      onClick={() => { onSelectContainer(selectedContainer === name ? null : name); close() }}
                      className={cn(
                        'flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs text-left transition-colors truncate',
                        selectedContainer === name
                          ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                          : 'text-[var(--foreground)] hover:bg-white/5'
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </>
              )}
              {bundles.length > 0 && (
                <>
                  <p className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
                    Bundles
                  </p>
                  {bundles.map(name => (
                    <button
                      key={name}
                      onClick={() => { onSelectContainer(selectedContainer === name ? null : name); close() }}
                      className={cn(
                        'flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs text-left transition-colors truncate',
                        selectedContainer === name
                          ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                          : 'text-[var(--foreground)] hover:bg-white/5'
                      )}
                    >
                      <Boxes size={10} className="opacity-40 shrink-0" />
                      {name}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </FilterChip>
      )}

      {/* Tags */}
      <FilterChip
        label="Tags"
        activeLabel={activeTagCount ? `${activeTagCount} tag${activeTagCount > 1 ? 's' : ''}` : null}
        icon={Sparkles}
        onClear={() => [...selectedAiTags].forEach(t => onToggleAiTag(t))}
      >
        {() => (
          <div className="p-1.5 max-h-72 overflow-y-auto" style={{ width: 220 }}>
            {AI_TAG_CATEGORIES.map(cat => {
              const catTags = AI_TAGS.filter(t => t.category === cat)
              return (
                <div key={cat}>
                  <p className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
                    {cat}
                  </p>
                  {catTags.map(t => {
                    const isSelected = selectedAiTags.includes(t.id)
                    return (
                      <button
                        key={t.id}
                        onClick={() => onToggleAiTag(t.id)}
                        className={cn(
                          'flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-left transition-colors',
                          isSelected ? 'text-[var(--foreground)]' : 'text-[var(--foreground)] hover:bg-white/5'
                        )}
                        style={isSelected ? { background: t.color + '18' } : {}}
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.color }} />
                        {t.label}
                        {isSelected && <X size={9} className="ml-auto opacity-50" />}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </FilterChip>

      {/* Clear all */}
      {activeCount > 0 && (
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-1.5 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <X size={10} />
          Clear {activeCount}
        </button>
      )}
    </div>
  )
}
