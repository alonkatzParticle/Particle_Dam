import { useState, useEffect, useCallback, useRef } from 'react'
import { FilterBar } from '../components/FilterBar'
import { SearchBar } from '../components/SearchBar'
import { SortControl } from '../components/SortControl'
import { AssetCard, AssetPreviewModal } from '../components/AssetCard'
import { TaskCard } from '../components/TaskCard'
import { TaskExpandedView } from '../components/TaskExpandedView'
import { InlineAssetPreview } from '../components/InlineAssetPreview'
import { MondayPanel } from '../components/MondayPanel'
import { EXT_GROUPS, cn } from '../lib/utils'
import { AI_TAG_MAP, AI_TAGS, AI_TAG_CATEGORIES, parseAiTags } from '../lib/aiTags'
import { ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useApiBase } from '../lib/ApiContext'
import { getCache, setCache } from '../lib/pageCache'

function Pagination({ page, pages, onPage }) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center gap-2 py-4 justify-center">
      <button onClick={() => onPage(page - 1)} disabled={page <= 1}
        className="p-1.5 rounded-lg border border-[var(--border)] hover:bg-white/5 disabled:opacity-30 transition-colors">
        <ChevronLeft size={14} />
      </button>
      <span className="text-sm text-[var(--muted-foreground)]">Page {page} of {pages}</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= pages}
        className="p-1.5 rounded-lg border border-[var(--border)] hover:bg-white/5 disabled:opacity-30 transition-colors">
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      <div className="skeleton" style={{ aspectRatio: '16/10' }} />
      <div className="p-3 space-y-2">
        <div className="skeleton h-4 w-3/4 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
      </div>
    </div>
  )
}

export default function LibraryPage() {
  const navigate   = useNavigate()
  const location   = useLocation()
  const apiBase    = useApiBase()
  const isAds      = location.pathname.startsWith('/ads')
  const isBrand    = location.pathname.startsWith('/brand')
  const sidebarMode = isBrand ? 'brand' : isAds ? 'ads' : 'raw'
  // apiBase is /api for Raw Files, /api-ad for Final Assets
  // Use it as the cache key so switching tabs never mixes data
  const cached = getCache(apiBase)
  const [tags, setTags]                 = useState(cached?.tags || [])
  const [assets, setAssets]             = useState(cached?.assets || [])
  const [total, setTotal]               = useState(cached?.total || 0)
  const [pages, setPages]               = useState(cached?.pages || 1)
  const [page, setPage]                 = useState(1)
  const [search, setSearch]             = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [selectedAiTags, setSelectedAiTags] = useState([])
  const [extFilter, setExtFilter]       = useState('')
  const [sort, setSort]                 = useState('newest')
  // Show skeletons only on true first load (no cache). Background refreshes are silent.
  const [loading, setLoading]           = useState(!cached)
  const [refreshing, setRefreshing]     = useState(false)  // subtle indicator only
  const [aiLoading, setAiLoading]       = useState(false)
  const [semanticMode, setSemanticMode] = useState(false)
  const [semanticAssets, setSemanticAssets] = useState([])
  const [semanticMessage, setSemanticMessage] = useState('')
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [containers, setContainers]       = useState({ products: [], bundles: [] })
  const [containerFilter, setContainerFilter] = useState(null)
  const [contentTypeFilter, setContentTypeFilter] = useState(null)
  // Ads: task-grouped view
  const [tasks, setTasks]               = useState([])
  const [expandedTask, setExpandedTask] = useState(null)
  // Final Assets (ads) specific
  const [mondayAsset, setMondayAsset]   = useState(null)
  const [linkMode, setLinkMode]         = useState(false)
  const [aiTagList, setAiTagList]       = useState(AI_TAGS)
  const [aiTagCategoryList, setAiTagCategoryList] = useState(AI_TAG_CATEGORIES)
  const [linkResult, setLinkResult]     = useState(null)
  const [linkLoading, setLinkLoading]   = useState(false)
  // Ads: dynamic Monday platform + campaign lists
  const [mondayPlatforms, setMondayPlatforms] = useState([])
  const [mondayCampaigns, setMondayCampaigns] = useState([])
  const [mondayProducts,  setMondayProducts]  = useState([])
  const [platformFilter,  setPlatformFilter]  = useState(null)
  const [campaignFilter,  setCampaignFilter]  = useState(null)
  const [adsProductFilter, setAdsProductFilter] = useState(null)
  const searchTimer = useRef(null)

  // ── URL deep-link sync: ?asset={dropbox_id} (opaque hex, not sequential int)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const dropboxId = params.get('asset')
    if (!dropboxId) return
    // The single-asset route already accepts dropbox_id via WHERE id=? OR dropbox_id=?
    // but we need to look it up — use the list endpoint with a path or just hit preview
    fetch(`${apiBase}/assets?dropbox_id=${encodeURIComponent(dropboxId)}&limit=1`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { const a = data?.assets?.[0]; if (a) setSelectedAsset(a) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally only on mount

  // ── Fetch AI tag taxonomy for this library (brand vs raw/ads) ─────────────
  useEffect(() => {
    fetch(`${apiBase}/ai-tags/taxonomy`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!Array.isArray(data) || !data.length) return
        setAiTagList(data.map(t => ({ ...t, color: t.color ?? '#6366f1' })))
        setAiTagCategoryList([...new Set(data.map(t => t.category))])
      })
      .catch(() => {})
  }, [apiBase])

  // Track if a content-type toggle happened so we can refetch the list on close
  const needsRefreshRef = useRef(false)

  function openAsset(asset) {
    needsRefreshRef.current = false
    handleSelectAsset(asset)
    const params = new URLSearchParams(location.search)
    params.set('asset', asset.dropbox_id)
    navigate({ search: params.toString() }, { replace: true })
  }

  function closeAsset() {
    setSelectedAsset(null)
    const params = new URLSearchParams(location.search)
    params.delete('asset')
    navigate({ search: params.toString() }, { replace: true })
    if (needsRefreshRef.current) {
      needsRefreshRef.current = false
      fetchAssets()
    }
  }

  // Fetch tags
  useEffect(() => {
    fetch(`${apiBase}/tags`).then(r => r.json()).then(t => {
      setTags(t)
      setCache(apiBase, { ...getCache(apiBase), tags: t })
    }).catch(() => {})
  }, [apiBase])

  // Fetch containers (Products + Bundles) for sidebar
  useEffect(() => {
    fetch(`${apiBase}/containers`).then(r => r.json()).then(setContainers).catch(() => {})
  }, [apiBase])

  const fetchAssets = useCallback(async (opts = {}) => {
    // hasCached = the current backend's cache already has data → refresh silently
    const hasCached = (getCache(apiBase)?.assets?.length > 0) && !opts._forceLoading
    if (hasCached) setRefreshing(true)
    else setLoading(true)
    try {
      const params = new URLSearchParams()
      const searchVal   = opts.search    !== undefined ? opts.search    : search
      const tagIds      = opts.tagIds    !== undefined ? opts.tagIds    : selectedTagIds
      const ext         = opts.extFilter !== undefined ? opts.extFilter : extFilter
      const aiTags      = opts.aiTags   !== undefined ? opts.aiTags   : selectedAiTags
      const currentPage = opts.page     !== undefined ? opts.page     : page
      const currentSort = opts.sort     !== undefined ? opts.sort     : sort

      const containerName  = opts.containerFilter  !== undefined ? opts.containerFilter  : containerFilter
      const contentType    = opts.contentTypeFilter !== undefined ? opts.contentTypeFilter : contentTypeFilter
      const platform       = opts.platformFilter    !== undefined ? opts.platformFilter    : platformFilter
      const campaign       = opts.campaignFilter    !== undefined ? opts.campaignFilter    : campaignFilter
      const adsProduct     = opts.adsProductFilter  !== undefined ? opts.adsProductFilter  : adsProductFilter

      if (searchVal)     params.set('search', searchVal)
      if (tagIds.length) params.set('tags', tagIds.join(','))
      if (aiTags.length) params.set('ai_tags', aiTags.join(','))
      if (ext) {
        const exts = EXT_GROUPS[ext]
        if (exts) params.set('ext', exts.join(','))
        else params.set('ext', ext)
      }
      if (containerName)  params.set('container_name', containerName)
      if (contentType)    params.set('content_type',   contentType)
      if (platform)       params.set('platform',       platform)
      if (campaign)       params.set('campaign',       campaign)
      if (adsProduct)     params.set('monday_product', adsProduct)
      if (isAds) params.set('monday_linked', 'true')
      params.set('sort', currentSort)
      params.set('page', currentPage)
      params.set('limit', '60')

      const data = await fetch(`${apiBase}/assets?${params}`).then(r => r.json())
      const newAssets = data.assets || []
      setAssets(newAssets)
      setTotal(data.total || 0)
      setPages(data.pages || 1)
      setCache(apiBase, {
        assets: newAssets,
        total:  data.total || 0,
        pages:  data.pages || 1,
        tags:   getCache(apiBase)?.tags || [],
      })
    } catch { if (!hasCached) setAssets([]) }
    finally { setLoading(false); setRefreshing(false) }
  }, [search, selectedTagIds, selectedAiTags, extFilter, containerFilter, contentTypeFilter, platformFilter, campaignFilter, adsProductFilter, sort, page, isAds, apiBase])

  // ── Ads task-grouped fetch ─────────────────────────────────────────────────
  const fetchTasks = useCallback(async (opts = {}) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      const searchVal = opts.search   !== undefined ? opts.search   : search
      const platform  = opts.platformFilter !== undefined ? opts.platformFilter : platformFilter
      const campaign  = opts.campaignFilter !== undefined ? opts.campaignFilter : campaignFilter
      const product   = opts.adsProductFilter !== undefined ? opts.adsProductFilter : adsProductFilter
      const currentPage = opts.page !== undefined ? opts.page : page

      if (searchVal) params.set('search', searchVal)
      if (platform)  params.set('platform', platform)
      if (campaign)  params.set('campaign', campaign)
      if (product)   params.set('product', product)
      params.set('page', currentPage)
      params.set('limit', '30')

      const data = await fetch(`${apiBase}/tasks?${params}`).then(r => r.json())
      setTasks(data.tasks || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
    } catch { setTasks([]) }
    finally { setLoading(false); setRefreshing(false) }
  }, [search, platformFilter, campaignFilter, adsProductFilter, page, apiBase])

  // Re-fetch whenever any filter changes
  useEffect(() => {
    if (isAds) fetchTasks()
    else fetchAssets()
  }, [apiBase, selectedTagIds, selectedAiTags, extFilter, containerFilter, contentTypeFilter, platformFilter, campaignFilter, adsProductFilter, sort, page])

  // Auto-refetch when a sync completes (fired by AppLayout)
  useEffect(() => {
    const handler = () => isAds ? fetchTasks() : fetchAssets()
    window.addEventListener('asset-library-synced', handler)
    return () => window.removeEventListener('asset-library-synced', handler)
  }, [fetchAssets, fetchTasks, isAds])

  // Pre-warm preview URLs for the first file of each visible task.
  // Fires immediately after the task grid loads so server-side temp links are
  // already cached by the time the user clicks a card.
  useEffect(() => {
    if (!isAds || !tasks.length) return
    // Spread requests out slightly so we don't hammer Dropbox all at once
    tasks.forEach((task, i) => {
      const firstAsset = task.assets?.[0]
      if (!firstAsset) return
      setTimeout(() => {
        fetch(`${apiBase}/assets/${firstAsset.id}/preview`).catch(() => {})
      }, i * 80) // 80ms stagger per task
    })
  }, [tasks, isAds, apiBase])


  // Ads: fetch dynamic Monday lists once
  useEffect(() => {
    if (!isAds) return
    fetch(`${apiBase}/monday/platforms`).then(r => r.ok ? r.json() : []).then(setMondayPlatforms).catch(() => {})
    fetch(`${apiBase}/monday/campaigns`).then(r => r.ok ? r.json() : []).then(setMondayCampaigns).catch(() => {})
    fetch(`${apiBase}/monday/products`).then(r  => r.ok ? r.json() : []).then(setMondayProducts).catch(() => {})
  }, [isAds, apiBase])

  // Debounce search — detect URLs for link-mode (ads only), otherwise normal search
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const isLink = isAds && /^https?:\/\/(.*\.)?monday\.com|dropbox\.com/.test(search.trim())
      if (isLink) {
        setLinkMode(true)
        setLinkLoading(true)
        try {
          const data = await fetch(`${apiBase}/assets/by-link?url=${encodeURIComponent(search.trim())}`).then(r => r.json())
          setLinkResult(data)
          setAssets(data.assets || [])
          setTotal(data.count || 0)
          setPages(1)
        } catch { setAssets([]) } finally { setLinkLoading(false) }
      } else {
        if (linkMode) {
          setLinkMode(false)
          setLinkResult(null)
        }
        if (isAds) {
          setPage(1)
          fetchTasks({ search, page: 1 })
        } else if (!search) {
          setSemanticMode(false)
          setSemanticAssets([])
          setSemanticMessage('')
          fetchAssets({ search: '', page: 1 })
        } else {
          setPage(1)
          fetchAssets({ search, page: 1 })
        }
      }
    }, 400)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  const handleToggleTag = id => {
    setPage(1)
    setSelectedTagIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleToggleAiTag = id => {
    setPage(1)
    setSelectedAiTags(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleExtFilter = key => {
    setPage(1)
    setExtFilter(key)
  }

  const handleClear = () => {
    setSelectedTagIds([])
    setSelectedAiTags([])
    setExtFilter('')
    setContainerFilter(null)
    setContentTypeFilter(null)
    setPlatformFilter(null)
    setCampaignFilter(null)
    setAdsProductFilter(null)
    setSemanticMode(false)
    setSemanticAssets([])
    setSemanticMessage('')
    setLinkMode(false)
    setLinkResult(null)
    setSearch('')
    setPage(1)
    if (isAds) fetchTasks({ search: '', page: 1 })
    else fetchAssets({ tagIds: [], aiTags: [], extFilter: '', search: '', page: 1 })
  }

  const handleAiSearch = async (query) => {
    if (!query?.trim()) return
    setSemanticMode(true)
    setAiLoading(true)
    setSemanticMessage('')
    try {
      const data = await fetch(`${apiBase}/search/semantic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      }).then(r => r.json())
      setSemanticAssets(data.assets || [])
      setSemanticMessage(data.message || '')
    } catch (err) {
      console.error('Semantic search failed:', err)
      setSemanticMode(false)
    } finally {
      setAiLoading(false)
    }
  }

  const handleAiTagsUpdated = (assetId, data) => {
    const patch = {
      ai_tags:        JSON.stringify(data.tags        || []),
      ai_actions:     JSON.stringify(data.actions     || []),
      ai_description: data.description || '',
    }
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, ...patch } : a))
    setSelectedAsset(prev => prev && prev.id === assetId ? { ...prev, ...patch } : prev)
  }

  // Fire use-count increment when an asset panel is opened (Raw + Brand only)
  const handleSelectAsset = (asset) => {
    setSelectedAsset(asset)
    if (asset && !isAds) {
      const lib = sidebarMode === 'brand' ? 'brand' : 'raw'
      fetch(`${apiBase.replace('/api/ads', `/api/${lib}`)}/assets/${asset.id}/use`, { method: 'POST' }).catch(() => {})
    }
  }

  const activeFilterCount = selectedTagIds.length + selectedAiTags.length + (extFilter ? 1 : 0)

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top toolbar: Search + Sort (sort lives here, right-aligned, distinct from filters) */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] shrink-0">
          <div className="flex-1">
            <SearchBar
              value={search}
              onChange={val => { setSearch(val); setPage(1); if (!val) { setSemanticMode(false); setSemanticAssets([]) } }}
              onAiSearch={handleAiSearch}
              onClearAi={() => { setSemanticMode(false); setSemanticAssets([]); setSemanticMessage('') }}
              aiActive={semanticMode}
              aiLoading={aiLoading}
              count={semanticMode ? semanticAssets.length : (!loading ? total : undefined)}
              loading={loading && !!search && !semanticMode}
            />
          </div>
          <SortControl value={sort} onChange={v => { setSort(v); setPage(1) }} />
        </div>

        {/* Filter chip bar */}
        <div className="px-6 py-2.5 border-b border-[var(--border)] shrink-0 flex items-center gap-2 flex-wrap">
          <FilterBar
            mode={sidebarMode}
            extFilter={extFilter}
            onExtFilter={handleExtFilter}
            selectedContentType={contentTypeFilter}
            onSelectContentType={type => { setContentTypeFilter(type); setPage(1) }}
            rawProducts={[
              ...(containers?.products || []),
              ...(containers?.bundles  || []),
            ]}
            selectedContainer={containerFilter}
            onSelectContainer={name => { setContainerFilter(name); setPage(1) }}
            mondayPlatforms={mondayPlatforms}
            mondayCampaigns={mondayCampaigns}
            mondayProducts={mondayProducts}
            platformFilter={platformFilter}
            campaignFilter={campaignFilter}
            adsProductFilter={adsProductFilter}
            onSelectPlatform={v => { setPlatformFilter(v); setPage(1) }}
            onSelectCampaign={v => { setCampaignFilter(v); setPage(1) }}
            onSelectAdsProduct={v => { setAdsProductFilter(v); setPage(1) }}
            selectedAiTags={selectedAiTags}
            onToggleAiTag={handleToggleAiTag}
            aiTagList={aiTagList}
            aiTagCategoryList={aiTagCategoryList}
            activeCount={
              selectedTagIds.length + selectedAiTags.length + (extFilter ? 1 : 0)
              + (containerFilter ? 1 : 0) + (contentTypeFilter ? 1 : 0)
              + (platformFilter ? 1 : 0) + (campaignFilter ? 1 : 0)
              + (adsProductFilter ? 1 : 0)
            }
            onClear={handleClear}
          />
        </div>

        {/* Link-mode banner — Final Assets only */}
        {isAds && linkMode && (
          <div className="mx-6 mt-3 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-sm shrink-0">
            {linkLoading ? (
              <span className="text-indigo-400 animate-pulse">Resolving link…</span>
            ) : linkResult?.error ? (
              <span className="text-red-400">{linkResult.error}</span>
            ) : (
              <>
                <span className="text-indigo-400 font-medium">
                  {linkResult?.type === 'monday' ? '📋 Monday task' : '📁 Dropbox folder'}
                </span>
                <span className="text-[var(--muted-foreground)]">·</span>
                <span className="text-[var(--foreground)] truncate flex-1">
                  {linkResult?.task_name || linkResult?.dropbox_path || `ID ${linkResult?.monday_id}`}
                </span>
                <span className="text-[var(--muted-foreground)] shrink-0">{linkResult?.count ?? 0} files</span>
              </>
            )}
            <button onClick={handleClear} className="ml-auto text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
              <X size={14} />
            </button>
          </div>
        )}

        {semanticMessage && (
          <div className="px-6 py-2 border-b border-[var(--border)] shrink-0">
            <p className="text-[11px] text-[var(--muted-foreground)]">{semanticMessage}</p>
          </div>
        )}

        {/* Grid — always visible */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {Array.from({ length: 20 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : isAds ? (
            tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <span className="text-4xl opacity-30">📋</span>
                <p className="text-[var(--muted-foreground)] text-sm">No tasks found</p>
                {(platformFilter || campaignFilter || adsProductFilter || search) && (
                  <button onClick={handleClear} className="text-[var(--primary)] text-sm hover:opacity-70 transition-opacity">Clear filters</button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 fade-in">
                  {tasks.map(task => (
                    <TaskCard
                      key={task.monday_id}
                      task={task}
                      onClick={() => {
                        setExpandedTask(task)
                        if (task.assets?.[0]) {
                          const first = task.assets[0]
                          handleSelectAsset(first.monday ? first : { ...first, monday: task })
                        }
                        // Pre-warm preview URLs for the remaining files so
                        // switching thumbnails in the drawer is instant
                        task.assets?.slice(1).forEach((a, i) => {
                          setTimeout(() => {
                            fetch(`${apiBase}/assets/${a.id}/preview`).catch(() => {})
                          }, i * 100)
                        })
                      }}
                    />
                  ))}
                </div>
                <Pagination page={page} pages={pages} onPage={p => { setPage(p); window.scrollTo(0, 0) }} />
              </>
            )
          ) : (semanticMode ? semanticAssets : assets).length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <span className="text-4xl opacity-30">{semanticMode ? '🔍' : '📂'}</span>
              <p className="text-[var(--muted-foreground)] text-sm">
                {semanticMode ? 'No semantically similar assets found — try a different description' : 'No assets found'}
              </p>
              {(activeFilterCount > 0 || semanticMode) && (
                <button onClick={handleClear} className="text-[var(--primary)] text-sm hover:opacity-70 transition-opacity">
                  Clear {semanticMode ? 'semantic search' : 'filters'}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 fade-in">
                {(semanticMode ? semanticAssets : assets).map(asset => (
                  <div key={asset.id} className="relative">
                    {semanticMode && asset._score && (
                      <div className="absolute top-1 left-1 z-10 bg-purple-500/80 backdrop-blur-sm text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {asset._score}%
                      </div>
                    )}
                    <AssetCard
                      asset={asset}
                      tags={tags}
                      onClick={openAsset}
                      onMondayClick={isAds ? (a => setMondayAsset(a)) : undefined}
                    />
                  </div>
                ))}
              </div>
              {!semanticMode && <Pagination page={page} pages={pages} onPage={p => { setPage(p); window.scrollTo(0, 0) }} />}
            </>
          )}
        </div>
      </div>

      {/* ── Ads overlay: backdrop + floating preview + drawer ── */}
      {isAds && expandedTask && (() => {
        const closeAll = () => { setExpandedTask(null); setSelectedAsset(null) }
        const DRAWER_H = 208
        return (
          <>
            {/* Backdrop — dims the grid, click to close */}
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={closeAll}
            />

            {/* Floating preview panel — sits above the drawer */}
            {selectedAsset && (
              <div
                className="fixed left-6 right-6 z-50 bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex"
                style={{ bottom: DRAWER_H + 12, maxHeight: 'calc(65vh)' }}
                onClick={e => e.stopPropagation()}
              >
                <InlineAssetPreview asset={selectedAsset} />
              </div>
            )}

            {/* Drawer strip */}
            <TaskExpandedView
              task={expandedTask}
              activeAssetId={selectedAsset?.id}
              onSelectAsset={asset => {
                const enriched = asset.monday ? asset : { ...asset, monday: expandedTask }
                handleSelectAsset(enriched)
              }}
              onClose={closeAll}
            />
          </>
        )
      })()}


      {/* AssetPreviewModal — raw/brand only, or ads mode without a task open */}
      {selectedAsset && !(isAds && expandedTask) && (
        <AssetPreviewModal
          asset={selectedAsset}
          tags={tags}
          onClose={() => {
            // In ads mode: close modal but keep task drawer open
            setSelectedAsset(null)
            if (!isAds) {
              const params = new URLSearchParams(location.search)
              params.delete('asset')
              navigate({ search: params.toString() }, { replace: true })
            }
            if (!isAds && needsRefreshRef.current) {
              needsRefreshRef.current = false
              fetchAssets()
            }
          }}
          onAiTagsUpdated={handleAiTagsUpdated}
          onContentTypeChange={(assetId, newType, newPath) => {
            needsRefreshRef.current = true
            setSelectedAsset(prev =>
              prev && prev.id === assetId
                ? { ...prev, content_type: newType, path: newPath }
                : prev
            )
          }}
        />
      )}

      {/* Monday panel — Final Assets only */}
      {isAds && (
        <MondayPanel
          asset={mondayAsset}
          onClose={() => setMondayAsset(null)}
          onRefresh={() => {
            fetchAssets()
            if (mondayAsset) {
              fetch(`${apiBase}/assets?search=${encodeURIComponent(mondayAsset.name)}&limit=1`)
                .then(r => r.json())
                .then(d => {
                  const updated = d.assets?.find(a => a.id === mondayAsset.id)
                  if (updated) setMondayAsset(updated)
                })
                .catch(() => {})
            }
          }}
        />
      )}
    </div>
  )
}
