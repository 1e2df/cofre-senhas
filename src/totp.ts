/**
 * Códigos 2FA de autenticador (TOTP — RFC 6238), os mesmos do Google Authenticator.
 *
 * Aceita a chave em Base32 (como os jogos mostram ao ativar o 2FA), um link
 * `otpauth://totp/...` (o conteúdo do QR code) ou `steam://CHAVE` para o Steam Guard.
 */

export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface TotpConfig {
  secret: Uint8Array;
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
  /** Steam Guard usa 5 caracteres alfanuméricos em vez de dígitos. */
  steam: boolean;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEAM_ALPHABET = '23456789BCDFGHJKMNPQRTVWXY';
const INVALID = 'Chave 2FA inválida';

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean) throw new Error(INVALID);

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(INVALID);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

export function parseTotp(input: string): TotpConfig {
  const text = input.trim();
  const defaults = { digits: 6, period: 30, algorithm: 'SHA-1' as TotpAlgorithm, steam: false };

  if (/^steam:\/\//i.test(text)) {
    return { ...defaults, digits: 5, steam: true, secret: base32Decode(text.slice('steam://'.length)) };
  }

  if (!/^otpauth:\/\//i.test(text)) {
    return { ...defaults, secret: base32Decode(text) };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(INVALID);
  }
  if (url.host.toLowerCase() !== 'totp') throw new Error('Só códigos baseados em tempo (TOTP) são suportados');

  const params = url.searchParams;
  const steam = params.get('encoder')?.toLowerCase() === 'steam';
  const digits = steam ? 5 : Number(params.get('digits') ?? 6);
  const period = Number(params.get('period') ?? 30);
  const algorithm = `SHA-${(params.get('algorithm') ?? 'SHA1').toUpperCase().replace(/^SHA-?/, '')}`;

  if (!Number.isInteger(digits) || digits < 5 || digits > 10) throw new Error(INVALID);
  if (!Number.isInteger(period) || period < 1) throw new Error(INVALID);
  if (!['SHA-1', 'SHA-256', 'SHA-512'].includes(algorithm)) throw new Error(INVALID);

  return {
    secret: base32Decode(params.get('secret') ?? ''),
    digits,
    period,
    algorithm: algorithm as TotpAlgorithm,
    steam,
  };
}

export async function generateTotp(config: TotpConfig, timeMs = Date.now()): Promise<string> {
  const counter = Math.floor(timeMs / 1000 / config.period);
  const message = new DataView(new ArrayBuffer(8));
  message.setUint32(0, Math.floor(counter / 2 ** 32));
  message.setUint32(4, counter >>> 0);

  const key = await crypto.subtle.importKey(
    'raw',
    config.secret,
    { name: 'HMAC', hash: config.algorithm },
    false,
    ['sign'],
  );
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message.buffer));

  // Truncamento dinâmico (RFC 4226, seção 5.3)
  const offset = hmac[hmac.length - 1] & 0x0f;
  let code = new DataView(hmac.buffer).getUint32(offset) & 0x7fffffff;

  if (config.steam) {
    let result = '';
    for (let i = 0; i < config.digits; i++) {
      result += STEAM_ALPHABET[code % STEAM_ALPHABET.length];
      code = Math.floor(code / STEAM_ALPHABET.length);
    }
    return result;
  }
  return String(code % 10 ** config.digits).padStart(config.digits, '0');
}

/** Segundos até o código atual expirar. */
export function secondsRemaining(period: number, timeMs = Date.now()): number {
  return period - (Math.floor(timeMs / 1000) % period);
}
