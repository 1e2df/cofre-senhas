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
  url: string;
  /** Login (usuário ou e-mail). */
  username: string;
  password: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export type EntryInput = Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>;

interface VaultData {
  entries: Entry[];
}

/** Subconjunto de `Storage` — permite usar um armazenamento em memória nos testes. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const STORAGE_KEY = 'cofre-senhas:vault';

const EMPTY_GAME_FIELDS = { platform: '', nickname: '', server: '', rank: '' };

/**
 * Cofre desbloqueado. Os dados ficam descriptografados apenas em memória;
 * toda alteração é recriptografada e gravada no armazenamento.
 */
export class Vault {
  private constructor(
    private readonly key: CryptoKey,
    private readonly salt: Uint8Array,
    private readonly iterations: number,
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

  /** Busca por texto e, opcionalmente, filtra por plataforma (vazio = todas). */
  search(query: string, platform = ''): Entry[] {
    const q = query.trim().toLowerCase();
    const sorted = [...this.data.entries]
      .filter((e) => !platform || e.platform.trim() === platform)
      .sort((a, b) => a.site.localeCompare(b.site, 'pt-BR') || a.nickname.localeCompare(b.nickname, 'pt-BR'));
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
