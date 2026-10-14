export interface GeneratorOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

export const CHARSETS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?',
} as const;

type CharsetName = keyof typeof CHARSETS;

/**
 * Inteiro aleatório em [0, max) sem viés.
 * Usar `random % max` direto favorece alguns valores; a amostragem por rejeição evita isso.
 */
function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

export function generatePassword(options: GeneratorOptions): string {
  const active = (Object.keys(CHARSETS) as CharsetName[]).filter((name) => options[name]);
  if (active.length === 0) {
    throw new Error('Selecione pelo menos um tipo de caractere');
  }
  if (options.length < active.length) {
    throw new Error(`O tamanho mínimo para essas opções é ${active.length}`);
  }

  // Garante ao menos um caractere de cada tipo selecionado
  const chars = active.map((name) => CHARSETS[name][randomInt(CHARSETS[name].length)]);

  const pool = active.map((name) => CHARSETS[name]).join('');
  while (chars.length < options.length) {
    chars.push(pool[randomInt(pool.length)]);
  }

  // Embaralha (Fisher-Yates) para que os caracteres garantidos não fiquem sempre no início
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
