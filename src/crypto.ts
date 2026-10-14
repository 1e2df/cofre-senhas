/**
 * Camada de criptografia usando a Web Crypto API nativa do navegador.
 *
 * - PBKDF2 (SHA-256) transforma a senha mestra em uma chave de 256 bits.
 * - AES-GCM criptografa e autentica os dados (detecta adulteração).
 */

// Recomendação da OWASP (2023) para PBKDF2-HMAC-SHA256
export const DEFAULT_ITERATIONS = 600_000;

export interface EncryptedPayload {
  version: 1;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations = DEFAULT_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // a chave não pode ser exportada
    ['encrypt', 'decrypt'],
  );
}

export async function encrypt(
  key: CryptoKey,
  plaintext: string,
  salt: Uint8Array,
  iterations: number,
): Promise<EncryptedPayload> {
  // Um IV novo a cada gravação: reutilizar IV com a mesma chave quebra o AES-GCM
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    version: 1,
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decrypt(key: CryptoKey, payload: EncryptedPayload): Promise<string> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv) },
      key,
      fromBase64(payload.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Senha mestra incorreta ou dados corrompidos');
  }
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p.version === 1 &&
    Number.isInteger(p.iterations) &&
    (p.iterations as number) > 0 &&
    typeof p.salt === 'string' &&
    typeof p.iv === 'string' &&
    typeof p.ciphertext === 'string'
  );
}
