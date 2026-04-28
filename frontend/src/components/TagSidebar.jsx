import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, Tag, X, Sparkles, Package, Boxes, Image, Film, Music, FileText, LayoutGrid } from 'lucide-react'

import { cn, EXT_GROUPS } from '../lib/utils'
import { AI_TAGS, AI_TAG_CATEGORIES } from '../lib/aiTags'

// ─── AI tag sections ─────────────────────────────────────────────────────────

const AI_TAG_SECTIONS = AI_TAG_CATEGORIES.map(cat => ({
  category: cat,
  tags: AI_TAGS.filter(t => t.category === cat),
}))

function AiTagSection({ section, selectedAiTags, onToggleAiTag }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-1 py-1 w-full text-left">
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
          {section.category}
        </span>
      </button>
      {open && (
        <div className="space-y-0.5 mb-1">
          {section.tags.map(t => {
            const isSelected = selectedAiTags.includes(t.id)
            return (
              <button
                key={t.id}
                onClick={() => onToggleAiTag(t.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] transition-colors text-left',
                  isSelected ? 'text-[var(--foreground)]' : 'text-[var(--sidebar-foreground)] hover:bg-white/5'
                )}
                style={isSelected ? { background: t.color + '18' } : {}}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.color }} />
                <span className="flex-1 truncate">{t.label}</span>
                {isSelected && <X size={10} className="shrink-0 opacity-60" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── File type filter ─────────────────────────────────────────────────────────

const EXT_FILTER_LABELS = [
  { key: '',          label: 'All Types',  Icon: LayoutGrid },
  { key: 'images',   label: 'Images',     Icon: Image },
  { key: 'videos',   label: 'Videos',     Icon: Film },
  { key: 'audio',    label: 'Audio',      Icon: Music },
  { key: 'documents',label: 'Documents',  Icon: FileText },
]

// ─── Collapsible container section (Products / Bundles) ───────────────────────

function ContainerSection({ label, icon: Icon, items, selectedContainer, onSelect, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full px-1 py-1 mb-1"
      >
        <Icon size={11} className="text-[var(--muted-foreground)] shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] flex-1 text-left">
          {label}
        </span>
        {open ? <ChevronDown size={10} className="text-[var(--muted-foreground)]" /> : <ChevronRight size={10} className="text-[var(--muted-foreground)]" />}
      </button>
      {open && (
        <div className="space-y-0.5 mb-1">
          {items.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)] px-2 py-1 opacity-50">None indexed yet</p>
          ) : items.map(name => {
            const isSelected = selectedContainer === name
            return (
              <button
                key={name}
                onClick={() => onSelect(isSelected ? null : name)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] transition-colors text-left',
                  isSelected
                    ? 'bg-[var(--primary)]/15 text-[var(--primary)] font-medium'
                    : 'text-[var(--sidebar-foreground)] hover:bg-white/5'
                )}
              >
                <span className="flex-1 truncate">{name}</span>
                {isSelected && <X size={10} className="shrink-0 opacity-60" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export function TagSidebar({
  mode = 'raw', // 'raw' | 'ads' | 'brand'
  tags, selectedTagIds, onToggleTag,
  extFilter, onExtFilter,
  selectedAiTags, onToggleAiTag,
  containers, selectedContainer, onSelectContainer,
  selectedContentType, onSelectContentType,
  onClear,
}) {
  const [aiOpen, setAiOpen] = useState(false)
  const isRaw = mode === 'raw'
  const activeCount = selectedTagIds.length + (extFilter ? 1 : 0) + selectedAiTags.length
    + (isRaw && selectedContainer ? 1 : 0)
    + (isRaw && selectedContentType ? 1 : 0)

  const products = containers?.products || []
  const bundles  = containers?.bundles  || []

  return (
    <aside className="w-56 shrink-0 border-r border-[var(--border)] bg-[var(--sidebar)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-widest">
          <Tag size={11} />
          Filters
        </div>
        {activeCount > 0 && (
          <button onClick={onClear} className="text-[11px] text-[var(--primary)] hover:opacity-70 transition-opacity">
            Clear {activeCount}
          </button>
        )}
      </div>

      {/* File type filter */}
      <div className="px-3 py-3 border-b border-[var(--border)] shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] px-1 mb-2">File Type</p>
        <div className="space-y-0.5">
          {EXT_FILTER_LABELS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => onExtFilter(key)}
              className={cn(
                'w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors',
                extFilter === key
                  ? 'bg-[var(--primary)]/15 text-[var(--primary)] font-medium'
                  : 'text-[var(--sidebar-foreground)] hover:bg-white/5'
              )}>
              <Icon size={13} className="shrink-0 opacity-70" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable filters */}
      <div className="flex-1 overflow-y-auto">

        {/* Content Type: AI / Real — Raw Files only */}
        {isRaw && (
          <div className="px-3 py-3 border-b border-[var(--border)]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] px-1 mb-2">Content Type</p>
            <div className="flex gap-1.5">
              {['real', 'ai', 'cta'].map(type => {
                const label = type === 'ai' ? 'AI' : type === 'real' ? 'Real' : 'CTA'
                const isSelected = selectedContentType === type
                return (
                  <button
                    key={type}
                    onClick={() => onSelectContentType(isSelected ? null : type)}
                    className={cn(
                      'flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all border',
                      isSelected
                        ? 'bg-[var(--primary)]/15 text-[var(--primary)] border-[var(--primary)]/30'
                        : 'text-[var(--sidebar-foreground)] border-white/10 hover:bg-white/5'
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Products + Bundles — Raw Files only */}
        {isRaw && (products.length > 0 || bundles.length > 0) && (
          <div className="px-3 py-3 border-b border-[var(--border)]">
            <ContainerSection
              label="Products"
              icon={Package}
              items={products}
              selectedContainer={selectedContainer}
              onSelect={onSelectContainer}
              defaultOpen={true}
            />
            {bundles.length > 0 && (
              <div className="mt-2">
                <ContainerSection
                  label="Bundles"
                  icon={Boxes}
                  items={bundles}
                  selectedContainer={selectedContainer}
                  onSelect={onSelectContainer}
                  defaultOpen={false}
                />
              </div>
            )}
          </div>
        )}

        {/* Tags (formerly AI Smart Tags) */}
        <div className="px-3 py-3">
          <button
            onClick={() => setAiOpen(o => !o)}
            className="flex items-center gap-2 w-full mb-2">
            <Sparkles size={11} className="text-[var(--primary)]" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] flex-1 text-left">
              Tags
            </span>
            {aiOpen ? <ChevronDown size={10} className="text-[var(--muted-foreground)]" /> : <ChevronRight size={10} className="text-[var(--muted-foreground)]" />}
          </button>
          {aiOpen && (
            <div className="space-y-1">
              {AI_TAG_SECTIONS.map(section => (
                <AiTagSection
                  key={section.category}
                  section={section}
                  selectedAiTags={selectedAiTags}
                  onToggleAiTag={onToggleAiTag}
                />
              ))}
            </div>
          )}
        </div>

      </div>
    </aside>
  )
}
