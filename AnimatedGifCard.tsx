import React, { useState, useEffect } from 'react';
import {
  Lock,
  Radio,
  Rocket,
  Activity,
  Terminal,
  Moon,
  Sparkles,
  Shield,
  Search,
  X,
  RefreshCw,
} from 'lucide-react';
import { CURATED_GIFS, GIPHY_API_KEY, type CuratedGifItem } from '../utils/mediaAssets';

export interface GiphyGifItem extends CuratedGifItem {
  giphyUrl?: string;
  source?: 'giphy-live' | 'giphy-curated';
}

interface AnimatedGifCardProps {
  gifId: string;
  title?: string;
  giphyUrl?: string;
  compact?: boolean;
}

export const AnimatedGifCard: React.FC<AnimatedGifCardProps> = ({
  gifId,
  title,
  giphyUrl,
  compact = false,
}) => {
  const [imageBroken, setImageBroken] = useState(false);
  const item: CuratedGifItem =
    CURATED_GIFS.find((g) => g.id === gifId) || CURATED_GIFS[0];
  const resolvedUrl = giphyUrl || item.giphyUrl;

  const renderMotifIcon = () => {
    const cls = compact ? 'w-7 h-7 text-white' : 'w-10 h-10 text-white';
    switch (item.motif) {
      case 'lock':
        return <Lock className={`${cls} animate-bounce`} />;
      case 'radar':
        return <Radio className={`${cls} animate-spin`} style={{ animationDuration: '4s' }} />;
      case 'rocket':
        return <Rocket className={`${cls} animate-bounce`} />;
      case 'wave':
        return <Activity className={`${cls} animate-pulse`} />;
      case 'terminal':
        return <Terminal className={`${cls} animate-pulse`} />;
      case 'moon':
        return <Moon className={`${cls} animate-bounce`} />;
      case 'spark':
        return <Sparkles className={`${cls} animate-spin`} style={{ animationDuration: '5s' }} />;
      case 'shield':
      default:
        return <Shield className={`${cls} animate-bounce`} />;
    }
  };

  return (
    <div
      className={`relative overflow-hidden rounded-lg select-none ${
        compact ? 'h-28 w-full' : 'h-44 w-64 sm:w-72'
      } flex flex-col justify-between p-3 text-white shadow-inner`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${item.accentFrom}, ${item.accentTo})`,
      }}
    >
      {resolvedUrl && !imageBroken && (
        <img
          src={resolvedUrl}
          alt={title || item.title}
          referrerPolicy="no-referrer"
          onError={() => setImageBroken(true)}
          className="absolute inset-0 w-full h-full object-cover opacity-85"
        />
      )}

      {/* Measured contrast scrim for legibility */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/30 pointer-events-none" />

      {/* Animated geometric SVG grid background when fallback or overlay */}
      <svg
        className="absolute inset-0 w-full h-full opacity-20 pointer-events-none"
        viewBox="0 0 200 120"
        preserveAspectRatio="none"
      >
        <defs>
          <pattern id={`grid-${item.id}`} width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.75" />
          </pattern>
        </defs>
        <rect width="200" height="120" fill={`url(#grid-${item.id})`} />
        <circle cx="165" cy="30" r="28" fill="none" stroke="white" strokeWidth="1.5" strokeDasharray="4 4" />
      </svg>

      <div className="relative z-10 flex items-center justify-between text-[10px] font-mono tracking-wider opacity-95">
        <span>GIPHY · E2EE GIF</span>
        <span>AES-256</span>
      </div>

      {(!resolvedUrl || imageBroken) && (
        <div className="relative z-10 flex items-center justify-center my-auto">
          <div className="p-2.5 rounded-full bg-black/25 backdrop-blur-xs border border-white/25">
            {renderMotifIcon()}
          </div>
        </div>
      )}

      <div className="relative z-10 mt-auto">
        <div className="font-mono text-[11px] font-bold tracking-wider uppercase truncate">
          {item.caption}
        </div>
        <div className="text-xs font-medium opacity-95 truncate">
          {title || item.title}
        </div>
      </div>
    </div>
  );
};

interface AnimatedGifPickerProps {
  darkMode: boolean;
  onSelectGif: (gif: GiphyGifItem) => void;
  onClose: () => void;
}

const CATEGORIES: Array<CuratedGifItem['category']> = [
  'All',
  'Security',
  'Reactions',
  'Late Night',
  'Ship It',
];

export const AnimatedGifPicker: React.FC<AnimatedGifPickerProps> = ({
  darkMode,
  onSelectGif,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CuratedGifItem['category']>('All');
  const [giphyResults, setGiphyResults] = useState<GiphyGifItem[]>(() =>
    CURATED_GIFS.map((g) => ({ ...g, source: 'giphy-curated' }))
  );
  const [loadingGiphy, setLoadingGiphy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoadingGiphy(true);
      try {
        const q = searchQuery.trim();
        const directUrl = q
          ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_API_KEY)}&q=${encodeURIComponent(q)}&limit=12&rating=g`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(GIPHY_API_KEY)}&limit=12&rating=g`;

        let loadedFromDirect = false;
        try {
          const directRes = await fetch(directUrl, { signal: controller.signal });
          if (directRes.ok) {
            const directJson = await directRes.json();
            if (Array.isArray(directJson.data) && directJson.data.length > 0 && !cancelled) {
              const mapped: GiphyGifItem[] = directJson.data.map((item: any, idx: number) => {
                const fallback = CURATED_GIFS[idx % CURATED_GIFS.length];
                return {
                  id: item.id || fallback.id,
                  title: item.title || fallback.title,
                  category: fallback.category,
                  keywords: [...fallback.keywords, q.toLowerCase()].filter(Boolean),
                  accentFrom: fallback.accentFrom,
                  accentTo: fallback.accentTo,
                  caption: 'GIPHY LIVE',
                  motif: fallback.motif,
                  giphyUrl:
                    item.images?.fixed_height_small?.url ||
                    item.images?.fixed_height?.url ||
                    item.images?.downsized_medium?.url ||
                    fallback.giphyUrl,
                  source: 'giphy-live',
                };
              });
              setGiphyResults(mapped);
              loadedFromDirect = true;
            }
          }
        } catch {
          // Proceed to server proxy fallback
        }

        if (!loadedFromDirect) {
          const endpoint = q
            ? `/api/giphy/search?q=${encodeURIComponent(q)}&limit=12`
            : `/api/giphy/trending?limit=12`;
          const res = await fetch(endpoint, { signal: controller.signal });
          if (res.ok) {
            const data = await res.json();
            if (!cancelled && Array.isArray(data.gifs) && data.gifs.length > 0) {
              setGiphyResults(data.gifs);
            }
          }
        }
      } catch {
        // Fallback to local Giphy curated list seamlessly
      } finally {
        if (!cancelled) setLoadingGiphy(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const filteredGifs = giphyResults.filter((gif) => {
    const matchesCategory = activeCategory === 'All' || gif.category === activeCategory;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return matchesCategory;
    return (
      matchesCategory &&
      (gif.title.toLowerCase().includes(q) ||
        gif.caption.toLowerCase().includes(q) ||
        gif.keywords.some((k) => k.toLowerCase().includes(q)))
    );
  });

  return (
    <div
      role="dialog"
      aria-label="Giphy Encrypted GIF Picker"
      className={`rounded-xl border p-4 shadow-xl ${
        darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
      }`}
    >
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">GIPHY Encrypted GIF Studio</span>
          <span className="text-[11px] font-mono text-sky-400">
            · Powered by GIPHY
          </span>
          {loadingGiphy && <RefreshCw className="w-3 h-3 animate-spin text-sky-400" />}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close GIF Picker"
          className="p-1 rounded-lg hover:bg-slate-800/50 text-slate-400 hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search & Category Filter */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search GIPHY (lock, ship, night, sync, celebrate)..."
            aria-label="Search Giphy GIFs"
            className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-sky-500 ${
              darkMode
                ? 'bg-slate-950 border-slate-800 text-slate-100 placeholder-slate-500'
                : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
            }`}
          />
        </div>

        <div
          className={`flex items-center gap-1 p-1 rounded-lg ${
            darkMode ? 'bg-slate-950' : 'bg-slate-100'
          }`}
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeCategory === cat
                  ? darkMode
                    ? 'bg-slate-800 text-sky-400'
                    : 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {filteredGifs.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400">
          No Giphy GIFs match "{searchQuery}". Try clearing the search filter.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-64 overflow-y-auto pr-1">
          {filteredGifs.map((gif) => (
            <button
              key={gif.id}
              type="button"
              onClick={() => onSelectGif(gif)}
              aria-label={`Send GIF ${gif.title}`}
              className="text-left group focus:outline-none focus:ring-2 focus:ring-sky-500 rounded-lg transition-transform hover:scale-[1.02] cursor-pointer"
            >
              <AnimatedGifCard
                gifId={gif.id}
                title={gif.title}
                giphyUrl={gif.giphyUrl}
                compact
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
