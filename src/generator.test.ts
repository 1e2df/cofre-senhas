import { describe, expect, it } from 'vitest';
import { CHARSETS, generatePassword, type GeneratorOptions } from './generator';

const ALL: GeneratorOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  numbers: true,
  symbols: true,
};

const containsAny = (text: string, charset: string) => [...text].some((c) => charset.includes(c));

describe('generatePassword', () => {
  it.each([8, 20, 64])('gera senha com %i caracteres', (length) => {
    expect(generatePassword({ ...ALL, length })).toHaveLength(length);
  });

  it('inclui pelo menos um caractere de cada tipo selecionado', () => {
    for (let i = 0; i < 50; i++) {
      const password = generatePassword({ ...ALL, length: 8 });
      expect(containsAny(password, CHARSETS.lowercase)).toBe(true);
      expect(containsAny(password, CHARSETS.uppercase)).toBe(true);
      expect(containsAny(password, CHARSETS.numbers)).toBe(true);
      expect(containsAny(password, CHARSETS.symbols)).toBe(true);
    }
  });

  it('usa apenas os tipos selecionados', () => {
    const password = generatePassword({
      length: 32,
      lowercase: false,
      uppercase: false,
      numbers: true,
      symbols: false,
    });
    expect(password).toMatch(/^\d{32}$/);
  });

  it('gera senhas diferentes a cada chamada', () => {
    const passwords = new Set(Array.from({ length: 100 }, () => generatePassword(ALL)));
    expect(passwords.size).toBe(100);
  });

  it('exige pelo menos um tipo de caractere', () => {
    expect(() =>
      generatePassword({ length: 10, lowercase: false, uppercase: false, numbers: false, symbols: false }),
    ).toThrow('Selecione pelo menos um tipo');
  });

  it('exige tamanho suficiente para os tipos selecionados', () => {
    expect(() => generatePassword({ ...ALL, length: 3 })).toThrow('tamanho mínimo');
  });
});
