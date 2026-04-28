// AI Smart Tag taxonomy — shared definition used by both backend prompt and frontend display.
// Keep tag IDs as clean lowercase-hyphen strings.

export const AI_TAGS = [

  // Style
  { id: 'ugc',           label: 'UGC',                 category: 'Style',   color: '#f59e0b' },
  { id: 'professional',  label: 'Professional',        category: 'Style',   color: '#6366f1' },
  { id: 'lifestyle',     label: 'Lifestyle',           category: 'Style',   color: '#ec4899' },
  { id: 'clinical',      label: 'Clinical',            category: 'Style',   color: '#06b6d4' },
  { id: 'dramatic',      label: 'Dramatic',            category: 'Style',   color: '#ef4444' },
  { id: 'minimal',       label: 'Minimal',             category: 'Style',   color: '#94a3b8' },

  // Subject
  { id: 'person',        label: 'Person',              category: 'Subject', color: '#f97316' },
  { id: 'woman',         label: 'Woman',               category: 'Subject', color: '#f472b6' },
  { id: 'man',           label: 'Man',                 category: 'Subject', color: '#60a5fa' },
  { id: 'couple',        label: 'Couple',              category: 'Subject', color: '#c084fc' },
  { id: 'face',          label: 'Face',                category: 'Subject', color: '#fb923c' },
  { id: 'hands',         label: 'Hands',               category: 'Subject', color: '#fdba74' },
  { id: 'product',       label: 'Product',             category: 'Subject', color: '#84cc16' },
  { id: 'product-shot',  label: 'Product Shot',        category: 'Subject', color: '#65a30d' },
  { id: 'packaging',     label: 'Packaging',           category: 'Subject', color: '#4d7c0f' },
  { id: 'text-graphic',  label: 'Text / Graphic',      category: 'Subject', color: '#0ea5e9' },

  // Age (only applied when a person is visible)
  { id: 'child',         label: 'Child (< 18)',        category: 'Age',     color: '#38bdf8' },
  { id: 'young-adult',   label: 'Young Adult (18–35)', category: 'Age',     color: '#7dd3fc' },
  { id: 'middle-aged',   label: 'Middle Aged (35–55)', category: 'Age',     color: '#bae6fd' },
  { id: 'senior',        label: 'Senior (55+)',        category: 'Age',     color: '#e0f2fe' },

  // Setting
  { id: 'indoor',        label: 'Indoor',              category: 'Setting', color: '#a78bfa' },
  { id: 'outdoor',       label: 'Outdoor',             category: 'Setting', color: '#34d399' },
  { id: 'bathroom',      label: 'Bathroom',            category: 'Setting', color: '#818cf8' },
  { id: 'kitchen',       label: 'Kitchen',             category: 'Setting', color: '#f472b6' },
  { id: 'studio',        label: 'Studio',              category: 'Setting', color: '#c084fc' },
  { id: 'nature',        label: 'Nature',              category: 'Setting', color: '#4ade80' },

  // Shot
  { id: 'close-up',      label: 'Close-up',            category: 'Shot',    color: '#fbbf24' },
  { id: 'medium-shot',   label: 'Medium Shot',         category: 'Shot',    color: '#f59e0b' },
  { id: 'wide-shot',     label: 'Wide Shot',           category: 'Shot',    color: '#d97706' },
  { id: 'overhead',      label: 'Overhead',            category: 'Shot',    color: '#b45309' },

  // Color palette
  { id: 'warm-tones',    label: 'Warm Tones',          category: 'Color',          color: '#f97316' },
  { id: 'cool-tones',    label: 'Cool Tones',          category: 'Color',          color: '#38bdf8' },
  { id: 'dark',          label: 'Dark & Moody',        category: 'Color',          color: '#475569' },
  { id: 'bright',        label: 'Bright',              category: 'Color',          color: '#fde68a' },

  // Clothing — specific garments
  { id: 'blazer',        label: 'Blazer / Jacket',    category: 'Clothing', color: '#818cf8' },
  { id: 'dress',         label: 'Dress',              category: 'Clothing', color: '#f472b6' },
  { id: 'polo-shirt',    label: 'Polo Shirt',         category: 'Clothing', color: '#34d399' },
  { id: 'cardigan',      label: 'Cardigan / Knit',    category: 'Clothing', color: '#fb923c' },
  { id: 't-shirt',       label: 'T-Shirt',            category: 'Clothing', color: '#a3e635' },
  { id: 'tank-top',      label: 'Tank Top',           category: 'Clothing', color: '#fde68a' },
  { id: 'hoodie',        label: 'Hoodie / Sweatshirt',category: 'Clothing', color: '#7dd3fc' },
  { id: 'button-shirt',  label: 'Button-Up / Blouse', category: 'Clothing', color: '#c084fc' },
  { id: 'bathrobe',      label: 'Bathrobe',           category: 'Clothing', color: '#d4b483' },
  { id: 'sweater',       label: 'Sweater',            category: 'Clothing', color: '#f9a8d4' },
  { id: 'athletic-top',  label: 'Athletic Top',       category: 'Clothing', color: '#6ee7b7' },
  { id: 'minimal-clothing', label: 'Minimal / No Top', category: 'Clothing', color: '#94a3b8' },

  // Clothing color
  { id: 'clothing-white',   label: 'White Clothing',   category: 'Clothing Color', color: '#e2e8f0' },
  { id: 'clothing-black',   label: 'Black Clothing',   category: 'Clothing Color', color: '#94a3b8' },
  { id: 'clothing-neutral', label: 'Neutral Clothing', category: 'Clothing Color', color: '#d4b483' },
  { id: 'clothing-pastel',  label: 'Pastel Clothing',  category: 'Clothing Color', color: '#f9a8d4' },
  { id: 'clothing-bold',    label: 'Bold / Bright Clothing', category: 'Clothing Color', color: '#f43f5e' },

  // Emotion (only when a face is clearly visible)
  { id: 'smiling',       label: 'Smiling',             category: 'Emotion', color: '#fde68a' },
  { id: 'confident',     label: 'Confident',           category: 'Emotion', color: '#f59e0b' },
  { id: 'relaxed',       label: 'Relaxed',             category: 'Emotion', color: '#6ee7b7' },
  { id: 'aspirational',  label: 'Aspirational',        category: 'Emotion', color: '#c4b5fd' },
  { id: 'neutral-expr',  label: 'Neutral Expression',  category: 'Emotion', color: '#94a3b8' },
]

export const AI_TAG_CATEGORIES = [...new Set(AI_TAGS.map(t => t.category))]

export const AI_TAG_MAP = Object.fromEntries(AI_TAGS.map(t => [t.id, t]))

export function parseAiTags(jsonStr) {
  if (!jsonStr) return []
  try { return JSON.parse(jsonStr) } catch { return [] }
}
