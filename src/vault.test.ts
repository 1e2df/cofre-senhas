import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY, Vault, type EntryInput, type KeyValueStore } from './vault';

const ITERATIONS = 1_000;
const MASTER = 'Mestra-Forte-123!';

class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const lol: EntryInput = {
  site: 'League of Legends',
  platform: 'Riot',
  nickname: 'Mago#BR1',
  server: 'BR1',
  rank: 'Ouro II',
  url: 'https://www.leagueoflegends.com',
  username: 'jogador@exemplo.com',
  password: 'senha-do-lol-123',
  notes: '',
};

const fifa: EntryInput = {
  site: 'EA FC 25',
  platform: 'PlayStation',
  nickname: 'CraqueBR',
  server: '',
  rank: 'Divisão 3',
  url: '',
  username: 'familia@exemplo.com',
  password: 'senha-da-psn-456',
  notes: 'Conta compartilhada',
};

describe('Vault', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('cria um cofre e reabre com a senha mestra', async () => {
    expect(Vault.exists(store)).toBe(false);
    const vault = await Vault.create(MASTER, store, ITERATIONS);
    await vault.add(lol);
    expect(Vault.exists(store)).toBe(true);

    const reopened = await Vault.unlock(MASTER, store);
    expect(reopened.entries).toHaveLength(1);
    expect(reopened.entries[0]).toMatchObject(lol);
  });

  it('nunca grava senhas em texto puro', async () => {
    const vault = await Vault.create(MASTER, store, ITERATIONS);
    await vault.add(lol);
    const raw = store.getItem(STORAGE_KEY)!;
    expect(raw).not.toContain(lol.password);
    expect(raw).not.toContain(lol.username);
  });

  it('rejeita a senha mestra errada', async () => {
    await Vault.create(MASTER, store, ITERATIONS);
    await expect(Vault.unlock('senha-errada', store)).rejects.toThrow('Senha mestra incorreta');
  });

  it('edita e remove contas', async () => {
    const vault = await Vault.create(MASTER, store, ITERATIONS);
    const entry = await vault.add(lol);

    await vault.update(entry.id, { ...lol, password: 'nova-senha' });
    expect((await Vault.unlock(MASTER, store)).entries[0].password).toBe('nova-senha');

    await vault.remove(entry.id);
    expect((await Vault.unlock(MASTER, store)).entries).toHaveLength(0);
  });

  it('falha ao editar ou remover uma conta inexistente', async () => {
    const vault = await Vault.create(MASTER, store, ITERATIONS);
    await expect(vault.update('nao-existe', lol)).rejects.toThrow('não encontrada');
    await expect(vault.remove('nao-existe')).rejects.toThrow('não encontrada');
  });

  it('busca por jogo, login, nick, plataforma ou URL e ordena por jogo', async () => {
    const vault = await Vault.create(MASTER, store, ITERATIONS);
    await vault.add(lol);
    await vault.add(fifa);

    expect(vault.search('').map((e) => e.site)).toEqual(['EA FC 25', 'League of Legends']);
    expect(vault.search('legends').map((e) => e.site)).toEqual(['League of Legends']);
    expect(vault.search('FAMILIA').map((e) => e.site)).toEqual(['EA FC 25']);
    expect(vault.search('craque').map((e) => e.site)).toEqual(['EA FC 25']);
    expect(vault.search('riot').map((e) => e.site)).toEqual(['League of Legends']);
    expect(vault.search('leagueoflegends.com').map((e) => e.site)).toEqual(['League of Legends']);
    expect(vault.search('inexistente')).toEqual([]);
  });

  it('filtra por plataforma e lista as plataformas usadas', async () => {
    const vault = await Vault.create(MASTER, store, ITERATIONS);
    await vault.add(lol);
    await vault.add(fifa);
    await vault.add({ ...lol, nickname: 'Smurf#BR1' });

    expect(vault.platforms()).toEqual(['PlayStation', 'Riot']);
    expect(vault.search('', 'Riot').map((e) => e.nickname)).toEqual(['Mago#BR1', 'Smurf#BR1']);
    expect(vault.search('smurf', 'Riot')).toHaveLength(1);
    expect(vault.search('smurf', 'PlayStation')).toEqual([]);
  });

  it('abre cofres antigos sem os campos de jogo', async () => {
    const vault = await Vault.create(MASTER, store, ITERATIONS);
    const { platform: _p, nickname: _n, server: _s, rank: _r, ...legacy } = lol;
    await vault.add(legacy as EntryInput);

    const reopened = await Vault.unlock(MASTER, store);
    expect(reopened.entries[0]).toMatchObject({ platform: '', nickname: '', server: '', rank: '' });
    expect(reopened.search('mago')).toEqual([]);
  });

  it('exporta e importa backup em outro armazenamento', async () => {
    const vault = await Vault.create(MASTER, store, ITERATIONS);
    await vault.add(lol);

    const otherDevice = new MemoryStore();
    Vault.importBackup(vault.exportBackup(), otherDevice);
    const restored = await Vault.unlock(MASTER, otherDevice);
    expect(restored.entries[0].site).toBe('League of Legends');
  });

  it('rejeita backup inválido sem sobrescrever o cofre atual', async () => {
    await Vault.create(MASTER, store, ITERATIONS);
    const before = store.getItem(STORAGE_KEY);

    expect(() => Vault.importBackup('isso não é json', store)).toThrow('inválido');
    expect(() => Vault.importBackup('{"foo": 1}', store)).toThrow('inválido');
    expect(store.getItem(STORAGE_KEY)).toBe(before);
  });
});
