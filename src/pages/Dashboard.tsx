import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Box, Package, MapPin, ChevronRight } from 'lucide-react'
import { useBins } from '@/hooks/useBins'
import { useItems } from '@/hooks/useItems'
import { Input } from '@/components/ui/primitives'
import { formatBinNumber } from '@/lib/utils'

export default function Dashboard() {
  const [search, setSearch] = useState('')
  const { bins, isLoading: binsLoading } = useBins()
  const { items, isLoading: itemsLoading } = useItems()
  const navigate = useNavigate()

  const q = search.toLowerCase()
  const filteredBins = bins.filter(b =>
    b.name.toLowerCase().includes(q) ||
    b.location.toLowerCase().includes(q) ||
    b.description.toLowerCase().includes(q)
  )
  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(q) ||
    i.description.toLowerCase().includes(q)
  )

  const getBinForItem = (binId: string) => bins.find(b => b.id === binId)

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl md:text-3xl">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">{bins.length} bins · {items.length} items</p>
      </div>

      {/* Search */}
      <div className="relative mb-8 sticky top-0 z-10 bg-background pb-2 pt-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search bins, locations, items..."
          className="pl-9"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Bins Section */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold text-lg">
            Bins {search && <span className="text-muted-foreground font-normal text-base">({filteredBins.length})</span>}
          </h2>
        </div>

        {binsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : filteredBins.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl">
            <Box className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{search ? 'No bins match your search' : 'No bins yet — create your first one!'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredBins.map(bin => {
              const itemCount = items.filter(i => i.binId === bin.id).length
              return (
                <button
                  key={bin.id}
                  onClick={() => navigate(`/bin/${bin.id}`)}
                  className="text-left rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition-all group overflow-hidden"
                >
                  <div className="h-1.5 w-full" style={{ backgroundColor: bin.color }} />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-muted-foreground">#{formatBinNumber(bin.binNumber)}</span>
                        </div>
                        <p className="font-semibold text-sm truncate">{bin.name}</p>
                        {bin.location && (
                          <div className="flex items-center gap-1 mt-1">
                            <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-xs text-muted-foreground truncate">{bin.location}</span>
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors mt-0.5" />
                    </div>
                    <div className="mt-3 flex items-center gap-1">
                      <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Items Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold text-lg">
            Items {search && <span className="text-muted-foreground font-normal text-base">({filteredItems.length})</span>}
          </h2>
        </div>

        {itemsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{search ? 'No items match your search' : 'No items yet'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredItems.map(item => {
              const bin = getBinForItem(item.binId)
              return (
                <button
                  key={item.id}
                  onClick={() => bin && navigate(`/bin/${bin.id}`)}
                  className="text-left rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition-all p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Qty: {item.quantity}</p>
                    </div>
                    {bin && (
                      <div className="shrink-0 flex items-center gap-1.5 bg-secondary rounded-full px-2 py-0.5">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: bin.color }} />
                        <span className="text-xs font-mono text-muted-foreground">#{formatBinNumber(bin.binNumber)}</span>
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
