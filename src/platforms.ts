/** Plataformas conhecidas, com cor de marca e um ícone curto para o avatar. */
export interface PlatformStyle {
  name: string;
  color: string;
  icon: string;
}

export const KNOWN_PLATFORMS: readonly PlatformStyle[] = [
  { name: 'Steam', color: '#2a475e', icon: '♨' },
  { name: 'Epic Games', color: '#3b3b46', icon: 'E' },
  { name: 'Battle.net', color: '#0e6fd8', icon: '✦' },
  { name: 'Riot', color: '#d13639', icon: '✊' },
  { name: 'EA App', color: '#e5383b', icon: 'EA' },
  { name: 'Ubisoft Connect', color: '#0062d1', icon: 'U' },
  { name: 'PlayStation', color: '#0057b8', icon: '△' },
  { name: 'Xbox', color: '#107c10', icon: 'Ⓧ' },
  { name: 'Nintendo', color: '#d90012', icon: 'N' },
  { name: 'Mobile', color: '#7c3aed', icon: '📱' },
];

// Cores escuras o bastante para texto branco, usadas em plataformas fora da lista
const FALLBACK_COLORS = ['#0f766e', '#9333ea', '#b45309', '#be185d', '#1d4ed8', '#4d7c0f', '#c2410c', '#475569'];

const normalize = (name: string) => name.trim().toLowerCase().replace(/[\s.]/g, '');

/**
 * Estilo da plataforma: cor de marca para as conhecidas (ignorando maiúsculas, espaços e pontos)
 * e uma cor estável, derivada do nome, para as demais. Sem plataforma, retorna `null`.
 */
export function platformStyle(name: string): PlatformStyle | null {
  const key = normalize(name);
  if (!key) return null;

  const known = KNOWN_PLATFORMS.find((p) => normalize(p.name) === key);
  if (known) return known;

  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return {
    name: name.trim(),
    color: FALLBACK_COLORS[hash % FALLBACK_COLORS.length],
    icon: name.trim().charAt(0).toUpperCase(),
  };
}
