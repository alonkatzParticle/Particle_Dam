import { useState, useRef, useEffect } from 'react'
import {
  ChevronDown, X, Film, Image, Music, FileText, LayoutGrid,
  Search, Sparkles, Package, Globe, Megaphone, Layers
} from 'lucide-react'
import { cn } from '../lib/utils'
import { AI_TAGS, AI_TAG_CATEGORIES, BRAND_AI_TAGS, BRAND_AI_TAG_CATEGORIES } from '../lib/aiTags'

// ─── File type groups ─────────────────────────────────────────────────────────
const TYPE_OPTIONS = [
  { value: 'videos',    label: 'Video',    Icon: Film },
  { value: 'images',    label: 'Image',    Icon: Image },
  { value: 'audio',     label: 'Audio',    Icon: Music },
  { value: 'documents', label: 'Document', Icon: FileText },
]

const BRAND_FORMAT_OPTIONS = [
  { value: 'svg',   label: 'SVG' },
  { value: 'png',   label: 'PNG' },
  { value: 'pdf',   label: 'PDF' },
  { value: 'c4d',   label: 'C4D' },
  { value: 'blend', label: 'Blender' },
  { value: 'exr',   label: 'EXR' },
  { value: 'zip',   label: 'ZIP' },
  { value: 'tif',   label: 'TIF' },
  { value: 'obj',   label: 'OBJ' },
  { value: 'fbx',   label: 'FBX' },
]

const CONTENT_OPTIONS = [
  { value: 'real', label: 'Real' },
  { value: 'ai',   label: 'AI Generated' },
  { value: 'cta',  label: 'CTA' },
]

// ─── Hook: close on outside click ────────────────────────────────────────────
function useClickOutside(ref, handler) {
  useEffect(() => {
    const listener = (e) => { if (ref.current && !ref.current.contains(e.target)) handler() }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [ref, handler])
}

// ─── SingleSelectChip ─────────────────────────────────────────────────────────
// Used for: Type, Product, Platform, Campaign, Content, Format
function SingleSelectChip({ label, value, options, onSelect, Icon, searchable = false }) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)
  useClickOutside(ref, () => { setOpen(false); setSearch('') })

  const active   = options.find(o => o.value === value)
  const isActive = !!active

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all select-none whitespace-nowrap',
          isActive
            ? 'bg-[var(--primary)]/15 text-[var(--primary)] border-[var(--primary)]/35'
            : 'bg-white/[0.04] text-[var(--muted-foreground)] border-white/[0.09] hover:bg-white/[0.07] hover:text-[var(--foreground)]'
        )}
      >
        {Icon && <Icon size={11} className="shrink-0" />}
        <span>{isActive ? active.label : label}</span>
        {isActive
          ? <X size={9} className="ml-0.5 shrink-0 opacity-60 hover:opacity-100"
              onClick={e => { e.stopPropagation(); onSelect(null); setOpen(false) }} />
          : <ChevronDown size={9} className={cn('ml-0.5 shrink-0 opacity-40 transition-transform', open && 'rotate-180')} />
        }
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ minWidth: 170, maxWidth: 240 }}>
          {searchable && (
            <div className="p-2 border-b border-[var(--border)] shrink-0">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07]">
                <Search size={11} className="text-[var(--muted-foreground)] shrink-0" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  autoFocus
                  className="flex-1 bg-transparent text-[11px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
                />
                {search && <X size={9} className="cursor-pointer opacity-40 hover:opacity-80 shrink-0" onClick={() => setSearch('')} />}
              </div>
            </div>
          )}
          <div className="overflow-y-auto p-1.5" style={{ maxHeight: 220 }}>
            {filtered.length === 0 && (
              <p className="text-center text-[11px] text-[var(--muted-foreground)] py-3">No results</p>
            )}
            {filtered.map(opt => {
              const isSelected = value === opt.value
              const OptIcon = opt.Icon
              return (
                <button
                  key={opt.value}
                  onClick={() => { onSelect(isSelected ? null : opt.value); setOpen(false); setSearch('') }}
                  className={cn(
                    'flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[11px] text-left transition-colors',
                    isSelected
                      ? 'bg-[var(--primary)]/12 text-[var(--primary)]'
                      : 'text-[var(--foreground)] hover:bg-white/[0.05]'
                  )}
                >
                  {/* Radio indicator */}
                  <span className={cn(
                    'w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors',
                    isSelected ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-white/20'
                  )}>
                    {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  {OptIcon && <OptIcon size={12} className="shrink-0 opacity-70" />}
                  <span className="truncate">{opt.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── MultiSelectTagPanel ──────────────────────────────────────────────────────
// Wide floating panel with search + grouped tag chips
function MultiSelectTagPanel({ selectedTags, onToggle, tagList, categoryList }) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)
  useClickOutside(ref, () => { setOpen(false); setSearch('') })

  const activeCount  = selectedTags.length
  const filtered     = search
    ? tagList.filter(t => t.label.toLowerCase().includes(search.toLowerCase()))
    : tagList
  const visibleCats  = search
    ? [...new Set(filtered.map(t => t.category))]
    : categoryList

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all select-none whitespace-nowrap',
          activeCount > 0
            ? 'bg-[var(--primary)]/15 text-[var(--primary)] border-[var(--primary)]/35'
            : 'bg-white/[0.04] text-[var(--muted-foreground)] border-white/[0.09] hover:bg-white/[0.07] hover:text-[var(--foreground)]'
        )}
      >
        <Sparkles size={11} className="shrink-0" />
        <span>Tags{activeCount > 0 ? ` · ${activeCount}` : ''}</span>
        {activeCount > 0
          ? <X size={9} className="ml-0.5 shrink-0 opacity-60 hover:opacity-100"
              onClick={e => { e.stopPropagation(); [...selectedTags].forEach(t => onToggle(t)) }} />
          : <ChevronDown size={9} className={cn('ml-0.5 shrink-0 opacity-40 transition-transform', open && 'rotate-180')} />
        }
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1.5 z-50 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col"
          style={{ width: 300, maxHeight: 380 }}
        >
          {/* Search */}
          <div className="p-2 border-b border-[var(--border)] shrink-0">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07]">
              <Search size={11} className="text-[var(--muted-foreground)] shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tags…"
                autoFocus
                className="flex-1 bg-transparent text-[11px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
              />
              {search && (
                <X size={9} className="cursor-pointer opacity-40 hover:opacity-80 shrink-0"
                  onClick={() => setSearch('')} />
              )}
            </div>
          </div>

          {/* Grouped tags */}
          <div className="overflow-y-auto p-2 flex-1">
            {visibleCats.map(cat => {
              const catTags = filtered.filter(t => t.category === cat)
              if (!catTags.length) return null
              return (
                <div key={cat} className="mb-3 last:mb-1">
                  <p className="px-0.5 mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
                    {cat}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {catTags.map(t => {
                      const isSelected = selectedTags.includes(t.id)
                      return (
                        <button
                          key={t.id}
                          onClick={() => onToggle(t.id)}
                          className={cn(
                            'flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border transition-all',
                            isSelected
                              ? 'text-[var(--primary)] border-[var(--primary)]/40 bg-[var(--primary)]/12'
                              : 'text-[var(--muted-foreground)] border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] hover:text-[var(--foreground)]'
                          )}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.color }} />
                          {t.label}
                          {isSelected && <X size={7} className="ml-0.5 opacity-60 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {visibleCats.length === 0 && (
              <p className="text-center text-[11px] text-[var(--muted-foreground)] py-6">No tags match</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FilterBar ────────────────────────────────────────────────────────────────
export function FilterBar({
  mode = 'raw',   // 'raw' | 'brand' | 'ads'

  // Type / Format
  extFilter, onExtFilter,

  // Raw: Content (AI/Real/CTA)
  selectedContentType, onSelectContentType,

  // Raw: Product (from folder/container_name)
  rawProducts = [], selectedContainer, onSelectContainer,

  // Ads: Monday dynamic lists
  mondayPlatforms = [], mondayCampaigns = [], mondayProducts = [],
  platformFilter, campaignFilter, adsProductFilter,
  onSelectPlatform, onSelectCampaign, onSelectAdsProduct,

  // AI Tags (multiselect)
  selectedAiTags, onToggleAiTag,
  aiTagList, aiTagCategoryList,

  // Clear all
  activeCount, onClear,
}) {
  const isRaw   = mode === 'raw'
  const isBrand = mode === 'brand'
  const isAds   = mode === 'ads'

  // Tag list defaults by mode
  const tagList  = isBrand ? BRAND_AI_TAGS  : (aiTagList  || AI_TAGS)
  const catList  = isBrand ? BRAND_AI_TAG_CATEGORIES : (aiTagCategoryList || AI_TAG_CATEGORIES)

  return (
    <div className="flex items-center gap-2 flex-wrap">

      {/* ── Type / Format ── */}
      {isBrand ? (
        <SingleSelectChip
          label="Format"
          value={extFilter || null}
          options={BRAND_FORMAT_OPTIONS}
          onSelect={v => onExtFilter(v || '')}
          Icon={LayoutGrid}
        />
      ) : (
        <SingleSelectChip
          label="Type"
          value={extFilter || null}
          options={TYPE_OPTIONS}
          onSelect={v => onExtFilter(v || '')}
          Icon={LayoutGrid}
        />
      )}

      {/* ── Raw: Product ── */}
      {isRaw && rawProducts.length > 0 && (
        <SingleSelectChip
          label="Product"
          value={selectedContainer}
          options={rawProducts.map(p => ({ value: p, label: p }))}
          onSelect={onSelectContainer}
          Icon={Package}
          searchable
        />
      )}

      {/* ── Raw: Content (AI / Real / CTA) ── */}
      {isRaw && (
        <SingleSelectChip
          label="Content"
          value={selectedContentType}
          options={CONTENT_OPTIONS}
          onSelect={onSelectContentType}
          Icon={Layers}
        />
      )}

      {/* ── Ads: Product ── */}
      {isAds && mondayProducts.length > 0 && (
        <SingleSelectChip
          label="Product"
          value={adsProductFilter}
          options={mondayProducts.map(p => ({ value: p, label: p }))}
          onSelect={onSelectAdsProduct}
          Icon={Package}
          searchable
        />
      )}

      {/* ── Ads: Platform ── */}
      {isAds && mondayPlatforms.length > 0 && (
        <SingleSelectChip
          label="Platform"
          value={platformFilter}
          options={mondayPlatforms.map(p => ({ value: p, label: p }))}
          onSelect={onSelectPlatform}
          Icon={Globe}
          searchable
        />
      )}

      {/* ── Ads: Campaign ── */}
      {isAds && mondayCampaigns.length > 0 && (
        <SingleSelectChip
          label="Campaign"
          value={campaignFilter}
          options={mondayCampaigns.map(c => ({ value: c, label: c }))}
          onSelect={onSelectCampaign}
          Icon={Megaphone}
          searchable
        />
      )}

      {/* ── Tags (multiselect panel) ── */}
      <MultiSelectTagPanel
        selectedTags={selectedAiTags}
        onToggle={onToggleAiTag}
        tagList={tagList}
        categoryList={catList}
      />

      {/* ── Clear all ── */}
      {activeCount > 0 && (
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <X size={9} />
          Clear {activeCount}
        </button>
      )}
    </div>
  )
}
