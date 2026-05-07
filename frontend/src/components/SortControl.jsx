import { useState, useRef, useEffect } from 'react'
import { Flame, Clock, ArrowUpDown, ArrowDownAZ, ChevronDown } from 'lucide-react'
import { cn } from '../lib/utils'

const SORT_OPTIONS = [
  { value: 'most_used', label: 'Most Used', Icon: Flame },
  { value: 'newest',    label: 'Newest',    Icon: Clock },
  { value: 'oldest',   label: 'Oldest',    Icon: ArrowUpDown },
  { value: 'name',     label: 'A → Z',     Icon: ArrowDownAZ },
]

/**
 * SortControl — lives in the search toolbar row, right-aligned.
 * Visually distinct from filter chips: no pill border, just an understated
 * "Sort: Newest ↓" text button with a floating menu.
 */
export function SortControl({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const active = SORT_OPTIONS.find(o => o.value === value) || SORT_OPTIONS[1]
  const ActiveIcon = active.Icon

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors select-none whitespace-nowrap group"
      >
        <span className="opacity-50 group-hover:opacity-70 transition-opacity">Sort</span>
        <span className="text-[var(--foreground)] font-medium">{active.label}</span>
        <ChevronDown
          size={11}
          className={cn('opacity-40 group-hover:opacity-70 transition-all', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 z-50 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden"
          style={{ minWidth: 155 }}
        >
          <div className="p-1.5">
            {SORT_OPTIONS.map(opt => {
              const OptIcon = opt.Icon
              const isSelected = value === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false) }}
                  className={cn(
                    'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[11px] text-left transition-colors',
                    isSelected
                      ? 'bg-[var(--primary)]/12 text-[var(--primary)]'
                      : 'text-[var(--foreground)] hover:bg-white/[0.05]'
                  )}
                >
                  <OptIcon size={12} className={cn('shrink-0', isSelected ? 'opacity-100' : 'opacity-50')} />
                  <span>{opt.label}</span>
                  {isSelected && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--primary)] shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
