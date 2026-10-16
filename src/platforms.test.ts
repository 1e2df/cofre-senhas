import { describe, expect, it } from 'vitest';
import { KNOWN_PLATFORMS, platformStyle } from './platforms';

describe('platformStyle', () => {
  it('reconhece plataformas conhecidas ignorando maiúsculas, espaços e pontos', () => {
    expect(platformStyle('Steam')?.color).toBe('#2a475e');
    expect(platformStyle('  playstation ')?.name).toBe('PlayStation');
    expect(platformStyle('battlenet')?.name).toBe('Battle.net');
    expect(platformStyle('EPICGAMES')?.name).toBe('Epic Games');
  });

  it('dá uma cor estável para plataformas desconhecidas', () => {
    const first = platformStyle('GOG');
    expect(first).toMatchObject({ name: 'GOG', icon: 'G' });
    expect(first?.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(platformStyle('gog')?.color).toBe(first?.color);
  });

  it('retorna null sem plataforma', () => {
    expect(platformStyle('')).toBeNull();
    expect(platformStyle('   ')).toBeNull();
  });

  it('não repete nomes na lista de conhecidas', () => {
    const names = KNOWN_PLATFORMS.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
