import { describe, expect, it } from 'vitest';
import { base32Decode, generateTotp, parseTotp, secondsRemaining } from './totp';

// Chaves dos vetores de teste oficiais da RFC 6238 (apêndice B), em Base32
const SHA1_KEY = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SHA256_KEY = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
const SHA512_KEY =
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';

const otpauth = (secret: string, algorithm: string) =>
  `otpauth://totp/Teste?secret=${secret}&digits=8&algorithm=${algorithm}`;

describe('base32Decode', () => {
  it('decodifica ignorando espaços, hífens, minúsculas e padding', () => {
    const expected = new TextEncoder().encode('12345678901234567890');
    expect(base32Decode(SHA1_KEY)).toEqual(expected);
    expect(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq==')).toEqual(expected);
  });

  it('rejeita caracteres fora do Base32', () => {
    expect(() => base32Decode('ABC1')).toThrow('inválida');
    expect(() => base32Decode('   ')).toThrow('inválida');
  });
});

describe('generateTotp', () => {
  it.each([
    [59, SHA1_KEY, 'SHA1', '94287082'],
    [1111111109, SHA1_KEY, 'SHA1', '07081804'],
    [20000000000, SHA1_KEY, 'SHA1', '65353130'],
    [59, SHA256_KEY, 'SHA256', '46119246'],
    [1234567890, SHA256_KEY, 'SHA256', '91819424'],
    [59, SHA512_KEY, 'SHA512', '90693936'],
    [2000000000, SHA512_KEY, 'SHA512', '38618901'],
  ])('vetor da RFC 6238: t=%i (%s, %s)', async (seconds, key, algorithm, expected) => {
    expect(await generateTotp(parseTotp(otpauth(key, algorithm)), seconds * 1000)).toBe(expected);
  });

  it('gera 6 dígitos por padrão a partir de uma chave Base32', async () => {
    const config = parseTotp(SHA1_KEY);
    expect(config).toMatchObject({ digits: 6, period: 30, algorithm: 'SHA-1', steam: false });
    expect(await generateTotp(config, 59_000)).toBe('287082');
  });

  it('mantém o código dentro do mesmo período e muda no seguinte', async () => {
    const config = parseTotp(SHA1_KEY);
    expect(await generateTotp(config, 30_000)).toBe(await generateTotp(config, 59_999));
    expect(await generateTotp(config, 60_000)).not.toBe(await generateTotp(config, 59_999));
  });

  it('gera códigos do Steam Guard com 5 caracteres do alfabeto do Steam', async () => {
    for (const input of [`steam://${SHA1_KEY}`, `otpauth://totp/Steam?secret=${SHA1_KEY}&encoder=steam`]) {
      const config = parseTotp(input);
      expect(config.steam).toBe(true);
      for (const time of [0, 59_000, 1_700_000_000_000]) {
        expect(await generateTotp(config, time)).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
      }
    }
  });
});

describe('parseTotp', () => {
  it('lê período, dígitos e algoritmo de um link otpauth', () => {
    const config = parseTotp(`otpauth://totp/Jogo:eu?secret=${SHA1_KEY}&period=60&digits=8&algorithm=SHA256`);
    expect(config).toMatchObject({ digits: 8, period: 60, algorithm: 'SHA-256', steam: false });
  });

  it('rejeita links inválidos ou que não são TOTP', () => {
    expect(() => parseTotp(`otpauth://hotp/Jogo?secret=${SHA1_KEY}`)).toThrow('TOTP');
    expect(() => parseTotp('otpauth://totp/Jogo')).toThrow('inválida');
    expect(() => parseTotp(`otpauth://totp/Jogo?secret=${SHA1_KEY}&digits=3`)).toThrow('inválida');
    expect(() => parseTotp(`otpauth://totp/Jogo?secret=${SHA1_KEY}&algorithm=MD5`)).toThrow('inválida');
  });
});

describe('secondsRemaining', () => {
  it('conta os segundos até o fim do período', () => {
    expect(secondsRemaining(30, 0)).toBe(30);
    expect(secondsRemaining(30, 29_000)).toBe(1);
    expect(secondsRemaining(30, 45_500)).toBe(15);
  });
});
