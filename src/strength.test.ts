import { describe, expect, it } from 'vitest';
import { evaluateStrength } from './strength';

describe('evaluateStrength', () => {
  it('senha vazia tem nota 0', () => {
    expect(evaluateStrength('')).toEqual({ score: 0, label: 'Muito fraca', entropy: 0 });
  });

  it.each(['123', 'abc', 'senha'])('"%s" é muito fraca', (password) => {
    expect(evaluateStrength(password).score).toBe(0);
  });

  it('caracteres repetidos não contam como senha forte', () => {
    expect(evaluateStrength('aaaaaaaaaaaaaaaaaaaaaaaa').score).toBe(0);
  });

  it('senha longa e variada é muito forte', () => {
    expect(evaluateStrength('xK9#mP2$vL7@qR4!nT8&').score).toBe(4);
  });

  it('nota aumenta com o tamanho', () => {
    const short = evaluateStrength('aB3$').entropy;
    const long = evaluateStrength('aB3$cD4%eF5^').entropy;
    expect(long).toBeGreaterThan(short);
  });
});
