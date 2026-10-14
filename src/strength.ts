export type StrengthScore = 0 | 1 | 2 | 3 | 4;

export interface Strength {
  score: StrengthScore;
  label: string;
  entropy: number;
}

const LABELS = ['Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Muito forte'] as const;

/**
 * Estimativa simples de entropia (bits) baseada nos tipos de caractere usados.
 * Repetições reduzem o "comprimento efetivo" para que "aaaaaaaaaaaa" não pareça forte.
 * É uma heurística — bibliotecas como zxcvbn também detectam palavras de dicionário.
 */
export function evaluateStrength(password: string): Strength {
  if (!password) return { score: 0, label: LABELS[0], entropy: 0 };

  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33;

  const uniqueChars = new Set(password).size;
  const effectiveLength = Math.min(password.length, uniqueChars * 2);
  const entropy = Math.round(effectiveLength * Math.log2(pool));

  let score: StrengthScore;
  if (entropy < 28) score = 0;
  else if (entropy < 36) score = 1;
  else if (entropy < 60) score = 2;
  else if (entropy < 80) score = 3;
  else score = 4;

  return { score, label: LABELS[score], entropy };
}
