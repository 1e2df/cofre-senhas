import { describe, expect, it } from 'vitest';
import {
  decrypt,
  deriveKey,
  encrypt,
  fromBase64,
  isEncryptedPayload,
  randomBytes,
  toBase64,
} from './crypto';

// Poucas iterações para os testes rodarem rápido; o app usa 600.000
const ITERATIONS = 1_000;

async function setup(password = 'senha-correta') {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, ITERATIONS);
  return { salt, key };
}

describe('base64', () => {
  it('converte ida e volta sem perder bytes', () => {
    const bytes = randomBytes(64);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe('encrypt / decrypt', () => {
  it('recupera o texto original com a chave correta', async () => {
    const { salt, key } = await setup();
    const payload = await encrypt(key, 'segredo com acentuação 🔐', salt, ITERATIONS);
    expect(await decrypt(key, payload)).toBe('segredo com acentuação 🔐');
  });

  it('não expõe o texto original no payload', async () => {
    const { salt, key } = await setup();
    const payload = await encrypt(key, 'minha-senha-secreta', salt, ITERATIONS);
    expect(JSON.stringify(payload)).not.toContain('minha-senha-secreta');
  });

  it('falha com a senha mestra errada', async () => {
    const { salt, key } = await setup();
    const payload = await encrypt(key, 'segredo', salt, ITERATIONS);
    const wrongKey = await deriveKey('senha-errada', salt, ITERATIONS);
    await expect(decrypt(wrongKey, payload)).rejects.toThrow('Senha mestra incorreta');
  });

  it('usa um IV diferente a cada criptografia', async () => {
    const { salt, key } = await setup();
    const a = await encrypt(key, 'mesmo texto', salt, ITERATIONS);
    const b = await encrypt(key, 'mesmo texto', salt, ITERATIONS);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('detecta dados adulterados', async () => {
    const { salt, key } = await setup();
    const payload = await encrypt(key, 'segredo', salt, ITERATIONS);
    const bytes = fromBase64(payload.ciphertext);
    bytes[0] ^= 0xff;
    await expect(decrypt(key, { ...payload, ciphertext: toBase64(bytes) })).rejects.toThrow();
  });
});

describe('isEncryptedPayload', () => {
  it('aceita um payload válido', async () => {
    const { salt, key } = await setup();
    expect(isEncryptedPayload(await encrypt(key, 'x', salt, ITERATIONS))).toBe(true);
  });

  it.each([null, 42, 'texto', {}, { version: 2, iterations: 1, salt: '', iv: '', ciphertext: '' }])(
    'rejeita %j',
    (value) => {
      expect(isEncryptedPayload(value)).toBe(false);
    },
  );
});
