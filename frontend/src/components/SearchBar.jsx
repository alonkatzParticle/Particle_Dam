import { useState, useEffect, useRef } from 'react'
import { Search, X, Sparkles } from 'lucide-react'
import { cn } from '../lib/utils'

export function SearchBar({ value, onChange, onAiSearch, aiActive, onClearAi, count, loading, aiLoading }) {
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  // Keyboard shortcut: / to focus
  useEffect(() => {
    const handler = e => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Auto-trigger semantic search on debounce (600ms after user stops typing)
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (value.trim().length >= 2) {
      debounceRef.current = setTimeout(() => {
        onAiSearch?.(value.trim())
      }, 600)
    }
    return () => clearTimeout(debounceRef.current)
  }, [value])

  const handleKeyDown = e => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault()
      clearTimeout(debounceRef.current)
      onAiSearch?.(value.trim())
    }
  }

  const handleClear = () => {
    onChange('')
    onClearAi?.()
  }

  return (
    <div className="space-y-1.5">
      <div className={cn(
        'relative flex items-center gap-2 px-3 py-2 rounded-xl border transition-all',
        focused
          ? 'border-[var(--primary)] bg-[var(--card)] shadow-[0_0_0_3px_rgba(124,106,247,0.15)]'
          : aiActive
            ? 'border-purple-500/40 bg-[var(--card)]'
            : 'border-[var(--border)] bg-[var(--input)]'
      )}>
        {aiLoading
          ? <Sparkles size={15} className="shrink-0 text-[var(--primary)] animate-pulse" />
          : aiActive
            ? <Sparkles size={15} className="shrink-0 text-purple-400" />
            : <Search size={15} className={cn('shrink-0 transition-colors', focused ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]')} />
        }
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={aiActive ? 'Searching semantically…' : 'Search assets…'}
          className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none min-w-0"
        />
        <div className="flex items-center gap-2 shrink-0">
          {(value || aiActive) && (
            <button onClick={handleClear} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
              <X size={13} />
            </button>
          )}
          {aiLoading
            ? <span className="text-[11px] text-purple-400 animate-pulse">Thinking…</span>
            : loading
              ? <span className="text-[11px] text-[var(--muted-foreground)] animate-pulse">Searching…</span>
              : count !== undefined && (
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  {count.toLocaleString()} result{count !== 1 ? 's' : ''}
                </span>
              )
          }
          {!focused && !value && !aiActive && (
            <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--muted-foreground)] font-mono">/</kbd>
          )}
        </div>
      </div>

      {/* AI expansion hint */}
      {!aiActive && !aiLoading && (
        <p className="text-[11px] text-[var(--muted-foreground)] px-1">
          <Sparkles size={9} className="inline mr-1 text-purple-400" />
          AI semantic search activates automatically as you type
        </p>
      )}
    </div>
  )
}
