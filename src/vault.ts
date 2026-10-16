import {
  DEFAULT_ITERATIONS,
  decrypt,
  deriveKey,
  encrypt,
  fromBase64,
  isEncryptedPayload,
  randomBytes,
  type EncryptedPayload,
} from './crypto';

export interface Entry {
  id: string;
  /** Nome do jogo. */
  site: string;
  /** Plataforma/launcher: Steam, PlayStation, Riot, Mobile… */
  platform: string;
  /** Nick / ID visível dentro do jogo. */
  nickname: string;
  /** Servidor ou região (ex.: BR1, NA, América do Sul). */
  server: string;
  /** Nível, rank ou elo. */
  rank: string;
  /** Uma das chaves de `ACCOUNT_TYPES`; vazio = não informado. */
  accountType: string;
  url: string;
  /** Login (usuário ou e-mail). */
  username: string;
  password: string;
  /** Chave do autenticador 2FA (Base32, otpauth:// ou steam://). Vazio = sem 2FA. */
  totpSecret: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export type EntryInput = Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>;

export const ACCOUNT_TYPES: Record<string, string> = {
  principal: 'Principal',
  smurf: 'Smurf / secundária',
  compartilhada: 'Compartilhada',
  banida: 'Banida',
};

/** Compara ignorando maiúsculas e acentos ("valorant" = "Valorant"). */
const compareText = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), 'pt-BR', { sensitivity: 'base' });

/** Ordem dos tipos dentro de um jogo: principal primeiro, sem tipo por último. */
const typeRank = (type: string) => {
  const index = Object.keys(ACCOUNT_TYPES).indexOf(type);
  return index === -1 ? Object.keys(ACCOUNT_TYPES).length : index;
};

/**
 * Escolhe como exibir um nome digitado de jeitos diferentes ("fortnite", "Fortnite"):
 * a grafia mais usada e, no empate, a que começa com maiúscula.
 */
export function preferredSpelling(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names.map((n) => n.trim()).filter(Boolean)) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const startsUpper = (s: string) => s.charAt(0) !== s.charAt(0).toLocaleLowerCase('pt-BR');
  let best = '';
  for (const [name, count] of counts) {
    const bestCount = counts.get(best) ?? 0;
    if (count > bestCount || (count === bestCount && startsUpper(name) && !startsUpper(best))) best = name;
  }
  return best;
}

export interface SearchFilters {
  /** Vazio = todas as plataformas. */
  platform?: string;
  /** Vazio = todos os tipos. */
  accountType?: string;
}

interface VaultData {
  entries: Entry[];
}

/** Subconjunto de `Storage` — permite usar um armazenamento em memória nos testes. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const STORAGE_KEY = 'cofre-senhas:vault';

const EMPTY_GAME_FIELDS = {
  platform: '',
  nickname: '',
  server: '',
  rank: '',
  accountType: '',
  totpSecret: '',
};

/**
 * Cofre desbloqueado. Os dados ficam descriptografados apenas em memória;
 * toda alteração é recriptografada e gravada no armazenamento.
 */
export class Vault {
  private constructor(
    private key: CryptoKey,
    private salt: Uint8Array,
    private iterations: number,
    private readonly data: VaultData,
    private readonly store: KeyValueStore,
  ) {}

  static exists(store: KeyValueStore = localStorage): boolean {
    return store.getItem(STORAGE_KEY) !== null;
  }

  static async create(
    masterPassword: string,
    store: KeyValueStore = localStorage,
    iterations = DEFAULT_ITERATIONS,
  ): Promise<Vault> {
    const salt = randomBytes(16);
    const key = await deriveKey(masterPassword, salt, iterations);
    const vault = new Vault(key, salt, iterations, { entries: [] }, store);
    await vault.save();
    return vault;
  }

  static async unlock(masterPassword: string, store: KeyValueStore = localStorage): Promise<Vault> {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) throw new Error('Nenhum cofre encontrado');

    const payload = parsePayload(raw);
    const salt = fromBase64(payload.salt);
    const key = await deriveKey(masterPassword, salt, payload.iterations);
    const data = JSON.parse(await decrypt(key, payload)) as VaultData;
    // Cofres antigos não têm os campos de jogo
    data.entries = data.entries.map((e) => ({ ...EMPTY_GAME_FIELDS, ...e }));
    return new Vault(key, salt, payload.iterations, data, store);
  }

  static destroy(store: KeyValueStore = localStorage): void {
    store.removeItem(STORAGE_KEY);
  }

  /** Substitui o cofre salvo por um backup (ainda criptografado). */
  static importBackup(raw: string, store: KeyValueStore = localStorage): void {
    parsePayload(raw);
    store.setItem(STORAGE_KEY, raw);
  }

  /** O backup é o próprio cofre criptografado — seguro para guardar fora do navegador. */
  exportBackup(): string {
    const raw = this.store.getItem(STORAGE_KEY);
    if (raw === null) throw new Error('Nenhum cofre encontrado');
    return raw;
  }

  get entries(): readonly Entry[] {
    return this.data.entries;
  }

  /** Busca por texto e, opcionalmente, filtra por plataforma e tipo de conta. */
  search(query: string, { platform = '', accountType = '' }: SearchFilters = {}): Entry[] {
    const q = query.trim().toLowerCase();
    const sorted = [...this.data.entries]
      .filter((e) => !platform || e.platform.trim() === platform)
      .filter((e) => !accountType || e.accountType === accountType)
      .sort(
        (a, b) =>
          compareText(a.site, b.site) ||
          typeRank(a.accountType) - typeRank(b.accountType) ||
          compareText(a.nickname, b.nickname),
      );
    if (!q) return sorted;
    return sorted.filter((e) =>
      [e.site, e.username, e.nickname, e.platform, e.server, e.url].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }

  /** Plataformas usadas nas contas salvas, sem repetição e em ordem alfabética. */
  platforms(): string[] {
    const names = new Set(this.data.entries.map((e) => e.platform.trim()).filter(Boolean));
    return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  /**
   * Contas que compartilham a senha com pelo menos outra conta.
   * Retorna, para cada id afetado, quantas contas usam aquela mesma senha.
   */
  reusedPasswords(): Map<string, number> {
    const byPassword = new Map<string, string[]>();
    for (const e of this.data.entries) {
      if (!e.password) continue;
      byPassword.set(e.password, [...(byPassword.get(e.password) ?? []), e.id]);
    }
    const result = new Map<string, number>();
    for (const ids of byPassword.values()) {
      if (ids.length > 1) for (const id of ids) result.set(id, ids.length);
    }
    return result;
  }

  /** Outras contas que já usam esta senha (para avisar enquanto o usuário digita). */
  accountsWithPassword(password: string, exceptId: string | null = null): Entry[] {
    if (!password) return [];
    return this.data.entries.filter((e) => e.id !== exceptId && e.password === password);
  }

  async add(input: EntryInput): Promise<Entry> {
    const now = Date.now();
    const entry: Entry = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    this.data.entries.push(entry);
    await this.save();
    return entry;
  }

  async update(id: string, input: EntryInput): Promise<Entry> {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) throw new Error('Conta não encontrada');
    Object.assign(entry, input, { updatedAt: Date.now() });
    await this.save();
    return entry;
  }

  async remove(id: string): Promise<void> {
    const index = this.data.entries.findIndex((e) => e.id === id);
    if (index === -1) throw new Error('Conta não encontrada');
    this.data.entries.splice(index, 1);
    await this.save();
  }

  /**
   * Troca a senha mestra: confere a atual, gera um salt novo e recriptografa tudo.
   * Backups exportados antes continuam abrindo só com a senha antiga.
   */
  async changeMasterPassword(
    currentPassword: string,
    newPassword: string,
    iterations = DEFAULT_ITERATIONS,
  ): Promise<void> {
    const currentKey = await deriveKey(currentPassword, this.salt, this.iterations);
    try {
      await decrypt(currentKey, parsePayload(this.exportBackup()));
    } catch {
      throw new Error('Senha mestra atual incorreta');
    }

    const salt = randomBytes(16);
    const key = await deriveKey(newPassword, salt, iterations);
    this.key = key;
    this.salt = salt;
    this.iterations = iterations;
    await this.save();
  }

  private async save(): Promise<void> {
    const payload = await encrypt(this.key, JSON.stringify(this.data), this.salt, this.iterations);
    this.store.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
}

function parsePayload(raw: string): EncryptedPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Arquivo de cofre inválido');
  }
  if (!isEncryptedPayload(parsed)) throw new Error('Arquivo de cofre inválido');
  return parsed;
}
