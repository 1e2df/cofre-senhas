import './style.css';
import { ACCOUNT_TYPES, Vault, preferredSpelling, type Entry, type EntryInput } from './vault';
import { KNOWN_PLATFORMS, platformStyle } from './platforms';
import { icon, type IconName } from './icons';
import { generatePassword, type GeneratorOptions } from './generator';
import { evaluateStrength } from './strength';
import { generateTotp, parseTotp, secondsRemaining, type TotpConfig } from './totp';

const AUTO_LOCK_MS = 5 * 60 * 1000;
const CLIPBOARD_CLEAR_MS = 30 * 1000;
const PASSWORD_REVEAL_MS = 20 * 1000;

let vault: Vault | null = null;
let editingId: string | null = null;
let lockTimer: number | undefined;
let clipboardTimer: number | undefined;
let toastTimer: number | undefined;
let totpTimer: number | undefined;
let onlyReused = false;

/** Jogos cujo grupo o usuário recolheu (chave = nome do jogo normalizado). */
const collapsedGames = new Set<string>();

/** Códigos 2FA visíveis na lista, atualizados a cada segundo. */
let totpWidgets: { config: TotpConfig; code: HTMLElement; timer: HTMLElement }[] = [];

// ---------- utilitários de DOM ----------

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento #${id} não encontrado`);
  return element as T;
}

/** Cria elementos sem innerHTML — o conteúdo do usuário nunca é interpretado como HTML. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const box = $('toast');
  box.textContent = message;
  box.dataset.kind = kind;
  box.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => box.classList.remove('visible'), 3500);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Desabilita o botão enquanto a chave é derivada (PBKDF2 leva ~1s de propósito). */
async function withBusy(button: HTMLButtonElement, label: string, task: () => Promise<void>) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    await task();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function submitButton(form: HTMLFormElement): HTMLButtonElement {
  return form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
}

function isSafeUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function bindStrengthMeter(input: HTMLInputElement, bar: HTMLElement, label: HTMLElement) {
  const update = () => {
    const { score, label: text, entropy } = evaluateStrength(input.value);
    bar.style.width = input.value ? `${(score + 1) * 20}%` : '0';
    bar.dataset.score = String(score);
    label.textContent = input.value ? `${text} · ~${entropy} bits` : '';
  };
  input.addEventListener('input', update);
  return update;
}

// ---------- telas ----------

const screens = {
  setup: $('setup-screen'),
  unlock: $('unlock-screen'),
  vault: $('vault-screen'),
};

function showScreen(name: keyof typeof screens): void {
  for (const [key, section] of Object.entries(screens)) section.hidden = key !== name;
  $('lock-btn').hidden = name !== 'vault';
  if (name === 'setup') $('setup-password').focus();
  if (name === 'unlock') $('unlock-password').focus();
}

function openVault(): void {
  showScreen('vault');
  renderEntries();
  resetLockTimer();
}

function lock(): void {
  vault = null;
  clearTimeout(lockTimer);
  clearInterval(totpTimer);
  totpWidgets = [];
  $<HTMLDialogElement>('entry-dialog').close();
  $<HTMLDialogElement>('master-dialog').close();
  $('entry-list').replaceChildren();
  $<HTMLInputElement>('search').value = '';
  $<HTMLSelectElement>('platform-filter').value = '';
  $<HTMLSelectElement>('type-filter').value = '';
  onlyReused = false;
  collapsedGames.clear();
  showScreen('unlock');
}

function resetLockTimer(): void {
  clearTimeout(lockTimer);
  lockTimer = window.setTimeout(() => {
    lock();
    toast('Cofre bloqueado por inatividade');
  }, AUTO_LOCK_MS);
}

for (const event of ['click', 'keydown', 'mousemove', 'touchstart']) {
  document.addEventListener(event, () => vault && resetLockTimer(), { passive: true });
}

// ---------- criação e desbloqueio ----------

const setupForm = $<HTMLFormElement>('setup-form');
const setupPassword = $<HTMLInputElement>('setup-password');
const updateSetupStrength = bindStrengthMeter(
  setupPassword,
  $('setup-strength-bar'),
  $('setup-strength-label'),
);

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = setupPassword.value;
  if (password !== $<HTMLInputElement>('setup-confirm').value) {
    return toast('As senhas não coincidem', 'error');
  }
  if (evaluateStrength(password).score < 2) {
    return toast('Escolha uma senha mestra mais forte', 'error');
  }
  await withBusy(submitButton(setupForm), 'Criando…', async () => {
    vault = await Vault.create(password);
    setupForm.reset();
    updateSetupStrength();
    openVault();
    toast('Cofre criado!');
  });
});

const unlockForm = $<HTMLFormElement>('unlock-form');
unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>('unlock-password');
  await withBusy(submitButton(unlockForm), 'Desbloqueando…', async () => {
    try {
      vault = await Vault.unlock(input.value);
      input.value = '';
      openVault();
    } catch (err) {
      toast(errorMessage(err), 'error');
      input.select();
    }
  });
});

$('reset-btn').addEventListener('click', () => {
  if (!confirm('Isso apaga TODAS as senhas salvas neste navegador. Tem certeza?')) return;
  Vault.destroy();
  showScreen('setup');
  toast('Cofre apagado');
});

$('lock-btn').addEventListener('click', () => {
  lock();
  toast('Cofre bloqueado');
});

// ---------- lista de contas ----------

/** Mantém o filtro de plataformas em sincronia com as contas salvas. */
function renderPlatformFilter(): void {
  if (!vault) return;
  const select = $<HTMLSelectElement>('platform-filter');
  const platforms = vault.platforms();
  const current = platforms.includes(select.value) ? select.value : '';
  select.replaceChildren(
    el('option', { value: '', textContent: 'Todas as plataformas' }),
    ...platforms.map((name) => el('option', { value: name, textContent: name })),
  );
  select.value = current;
  select.hidden = platforms.length === 0;
}

function formatTotp(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

async function refreshTotpCodes(): Promise<void> {
  const now = Date.now();
  for (const { config, code, timer } of totpWidgets) {
    const remaining = secondsRemaining(config.period, now);
    code.textContent = formatTotp(await generateTotp(config, now));
    timer.textContent = `${remaining}s`;
    timer.classList.toggle('expiring', remaining <= 5);
  }
}

function startTotpTicker(): void {
  clearInterval(totpTimer);
  if (totpWidgets.length === 0) return;
  refreshTotpCodes();
  totpTimer = window.setInterval(refreshTotpCodes, 1000);
}

async function copyTotp(config: TotpConfig): Promise<void> {
  await copyToClipboard(await generateTotp(config), 'Código 2FA copiado');
}

/** Linha com o código 2FA atual; chaves inválidas aparecem como aviso em vez de quebrar a lista. */
function renderTotp(entry: Entry): HTMLElement | null {
  if (!entry.totpSecret) return null;
  let config: TotpConfig;
  try {
    config = parseTotp(entry.totpSecret);
  } catch {
    return el('small', { className: 'danger', textContent: '⚠ Chave 2FA inválida — edite a conta' });
  }
  const code = el('span', { className: 'totp-code', textContent: '••• •••' });
  const timer = el('span', { className: 'totp-timer muted' });
  totpWidgets.push({ config, code, timer });
  return el(
    'button',
    { type: 'button', className: 'totp', title: 'Copiar código 2FA', onclick: () => copyTotp(config) },
    icon('shield'),
    code,
    timer,
  );
}

/** Aviso no topo da lista quando há senhas repetidas, com atalho para filtrar essas contas. */
function renderReuseBanner(reused: Map<string, number>): void {
  if (reused.size === 0) onlyReused = false;
  $('reuse-banner').hidden = reused.size === 0;
  $('reuse-banner-text').textContent =
    `⚠ ${reused.size} ${reused.size === 1 ? 'conta usa' : 'contas usam'} senha repetida. ` +
    'Se uma vazar, as outras ficam expostas.';
  $('reuse-filter-btn').textContent = onlyReused ? 'Mostrar todas' : 'Mostrar só essas';
}

function renderEntries(): void {
  if (!vault) return;
  renderPlatformFilter();
  totpWidgets = [];
  const reused = vault.reusedPasswords();
  renderReuseBanner(reused);
  const items = vault
    .search($<HTMLInputElement>('search').value, {
      platform: $<HTMLSelectElement>('platform-filter').value,
      accountType: $<HTMLSelectElement>('type-filter').value,
    })
    .filter((e) => !onlyReused || reused.has(e.id));

  const nodes = [...groupByGame(items)].map(([key, group]) =>
    group.length === 1
      ? renderEntry(group[0], reused.get(group[0].id))
      : renderGameGroup(key, group, reused),
  );
  $('entry-list').replaceChildren(...nodes);
  startTotpTicker();

  const empty = $('empty-state');
  empty.hidden = items.length > 0;
  empty.textContent =
    vault.entries.length === 0
      ? 'Nenhuma conta de jogo salva ainda. Clique em "+ Nova conta" para começar.'
      : 'Nenhum resultado para a busca.';
}

const gameKey = (entry: Entry) => entry.site.trim().toLocaleLowerCase('pt-BR');

/** Agrupa mantendo a ordem da busca (que já vem ordenada por jogo). */
function groupByGame(items: Entry[]): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  for (const entry of items) groups.set(gameKey(entry), [...(groups.get(gameKey(entry)) ?? []), entry]);
  return groups;
}

/** Jogo com várias contas: um bloco que abre e fecha, lembrando o estado entre buscas. */
function renderGameGroup(key: string, group: Entry[], reused: Map<string, number>): HTMLLIElement {
  const details = el('details', { className: 'game-group', open: !collapsedGames.has(key) });
  details.addEventListener('toggle', () => {
    if (details.open) collapsedGames.delete(key);
    else collapsedGames.add(key);
  });
  details.append(
    el(
      'summary',
      {},
      el('strong', { textContent: preferredSpelling(group.map((e) => e.site)) }),
      el('span', { className: 'muted', textContent: ` · ${group.length} contas` }),
    ),
    el('ul', { className: 'entry-list' }, ...group.map((e) => renderEntry(e, reused.get(e.id)))),
  );
  return el('li', {}, details);
}

/** Etiqueta da plataforma com a cor da marca. */
function renderPlatformBadge(platform: string): HTMLElement | null {
  const style = platformStyle(platform);
  if (!style) return null;
  const badge = el('span', { className: 'badge platform', textContent: `${style.icon} ${platform}` });
  badge.style.setProperty('--platform-color', style.color);
  return badge;
}

function renderEntry(entry: Entry, reuseCount?: number): HTMLLIElement {
  const title = isSafeUrl(entry.url)
    ? el('a', { href: entry.url, target: '_blank', rel: 'noopener noreferrer', textContent: entry.site })
    : el('span', { textContent: entry.site });

  /** Botão com ícone; sem `text`, mostra só o ícone e usa `label` como nome acessível. */
  const action = (name: IconName, label: string, onclick: () => void, text = '', extraClass = '') => {
    const button = el(
      'button',
      { type: 'button', className: `btn ghost small ${text ? '' : 'icon-only'} ${extraClass}`, title: label, onclick },
      icon(name),
    );
    button.setAttribute('aria-label', label);
    if (text) button.append(el('span', { textContent: text }));
    return button;
  };

  const tags = el('div', { className: 'tags' });
  const platformBadge = renderPlatformBadge(entry.platform);
  if (platformBadge) tags.append(platformBadge);
  if (entry.accountType) {
    tags.append(
      el('span', {
        className: `badge type-${entry.accountType}`,
        textContent: ACCOUNT_TYPES[entry.accountType] ?? entry.accountType,
      }),
    );
  }
  const heading = el('div', { className: 'entry-title' }, el('strong', {}, title), tags);

  const avatar = el('div', { className: 'entry-avatar', textContent: entry.site.charAt(0).toUpperCase() });
  const style = platformStyle(entry.platform);
  if (style) {
    avatar.style.background = style.color;
    avatar.style.color = '#fff';
    avatar.title = style.name;
  }

  // Senha visível só sob demanda, e escondida de novo depois de alguns segundos
  const passwordLine = el('code', { className: 'password-reveal', hidden: true, textContent: entry.password });
  let revealTimer: number | undefined;
  const togglePassword = (show = passwordLine.hidden) => {
    passwordLine.hidden = !show;
    const label = show ? 'Ocultar senha' : 'Ver senha';
    revealButton.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
    revealButton.title = label;
    revealButton.setAttribute('aria-label', label);
    clearTimeout(revealTimer);
    if (show) revealTimer = window.setTimeout(() => togglePassword(false), PASSWORD_REVEAL_MS);
  };
  const revealButton = action('eye', 'Ver senha', () => togglePassword());

  const details = [entry.nickname && `🎮 ${entry.nickname}`, entry.server, entry.rank]
    .filter(Boolean)
    .join('  ·  ');

  return el(
    'li',
    { className: 'entry' },
    avatar,
    el(
      'div',
      { className: 'entry-main' },
      heading,
      el('span', { className: 'entry-details', textContent: details }),
      el('span', { className: 'entry-login muted', textContent: entry.username }),
      reuseCount
        ? el('small', { className: 'warning-text', textContent: `⚠ Senha repetida em ${reuseCount} contas` })
        : '',
      passwordLine,
      renderTotp(entry) ?? '',
    ),
    el(
      'div',
      { className: 'entry-actions' },
      action('user', 'Copiar login', () => copyToClipboard(entry.username, 'Login copiado'), 'Login'),
      action(
        'key',
        'Copiar senha',
        () => copyToClipboard(entry.password, 'Senha copiada — será apagada em 30s', true),
        'Senha',
      ),
      revealButton,
      action('pencil', 'Editar', () => openEntryDialog(entry)),
      action('trash', 'Excluir', () => deleteEntry(entry), '', 'danger'),
    ),
  );
}

async function copyToClipboard(text: string, message: string, sensitive = false): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
    if (sensitive) {
      clearTimeout(clipboardTimer);
      clipboardTimer = window.setTimeout(() => {
        // Pode falhar se a aba não estiver em foco; nesse caso não há o que fazer
        navigator.clipboard.writeText('').catch(() => {});
      }, CLIPBOARD_CLEAR_MS);
    }
  } catch {
    toast('Não foi possível copiar', 'error');
  }
}

async function deleteEntry(entry: Entry): Promise<void> {
  const label = entry.nickname ? `${entry.site} (${entry.nickname})` : entry.site;
  if (!vault || !confirm(`Excluir a conta "${label}"?`)) return;
  try {
    await vault.remove(entry.id);
    renderEntries();
    toast('Conta excluída');
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

$('search').addEventListener('input', renderEntries);
$('platform-filter').addEventListener('change', renderEntries);
$('type-filter').addEventListener('change', renderEntries);
$('reuse-filter-btn').addEventListener('click', () => {
  onlyReused = !onlyReused;
  renderEntries();
});
$('add-btn').addEventListener('click', () => openEntryDialog());

// ---------- formulário de conta ----------

const dialog = $<HTMLDialogElement>('entry-dialog');
const entryForm = $<HTMLFormElement>('entry-form');
const entryPassword = $<HTMLInputElement>('entry-password');
const generatorBox = $('generator');
const updateEntryStrength = bindStrengthMeter(
  entryPassword,
  $('entry-strength-bar'),
  $('entry-strength-label'),
);

const ENTRY_FIELDS = [
  'site',
  'platform',
  'nickname',
  'server',
  'rank',
  'accountType',
  'url',
  'username',
  'password',
  'totpSecret',
  'notes',
] as const;

function openEntryDialog(entry?: Entry): void {
  editingId = entry?.id ?? null;
  entryForm.reset();
  $('entry-dialog-title').textContent = entry ? 'Editar conta' : 'Nova conta';
  if (entry) {
    for (const name of ENTRY_FIELDS) {
      (entryForm.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value = entry[name];
    }
  }
  entryPassword.type = 'password';
  generatorBox.hidden = true;
  updateEntryStrength();
  updateReuseWarning();
  updateTotpPreview();
  dialog.showModal();
}

entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!vault) return;

  const data = new FormData(entryForm);
  const field = (name: string) => String(data.get(name) ?? '');
  const input: EntryInput = {
    site: field('site').trim(),
    // "riot" vira "Riot": evita a mesma plataforma aparecer duas vezes no filtro
    platform: platformStyle(field('platform'))?.name ?? '',
    nickname: field('nickname').trim(),
    server: field('server').trim(),
    rank: field('rank').trim(),
    accountType: field('accountType'),
    url: field('url').trim(),
    username: field('username').trim(),
    password: field('password'),
    totpSecret: field('totpSecret').trim(),
    notes: field('notes'),
  };

  if (input.totpSecret) {
    try {
      parseTotp(input.totpSecret);
    } catch (err) {
      $('entry-totp').focus();
      return toast(errorMessage(err), 'error');
    }
  }

  const isEditing = editingId !== null;
  try {
    if (editingId) await vault.update(editingId, input);
    else await vault.add(input);
    dialog.close();
    renderEntries();
    toast(isEditing ? 'Conta atualizada' : 'Conta salva');
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
});

$('entry-cancel').addEventListener('click', () => dialog.close());

/** Avisa, enquanto digita, se a senha já é usada em outra conta. */
function updateReuseWarning(): void {
  const warning = $('entry-reuse-warning');
  const others = vault?.accountsWithPassword(entryPassword.value, editingId) ?? [];
  warning.hidden = others.length === 0;
  const names = others.map((e) => (e.nickname ? `${e.site} (${e.nickname})` : e.site));
  warning.textContent = `⚠ Esta senha já é usada em: ${names.join(', ')}. Use o botão "Gerar" para criar uma única.`;
}
entryPassword.addEventListener('input', updateReuseWarning);

const entryTotp = $<HTMLInputElement>('entry-totp');

/** Mostra o código gerado pela chave digitada, para conferir com o app do jogo antes de salvar. */
async function updateTotpPreview(): Promise<void> {
  const preview = $('entry-totp-preview');
  const value = entryTotp.value.trim();
  preview.classList.remove('danger');
  if (!value) {
    preview.textContent = '';
    return;
  }
  try {
    preview.textContent = `Código atual: ${formatTotp(await generateTotp(parseTotp(value)))}`;
  } catch (err) {
    preview.textContent = errorMessage(err);
    preview.classList.add('danger');
  }
}
entryTotp.addEventListener('input', updateTotpPreview);

$('toggle-entry-password').addEventListener('click', () => {
  entryPassword.type = entryPassword.type === 'password' ? 'text' : 'password';
});

// ---------- gerador ----------

const genLength = $<HTMLInputElement>('gen-length');
const generatorChecks = ['lowercase', 'uppercase', 'numbers', 'symbols'] as const;

function readGeneratorOptions(): GeneratorOptions {
  const checked = (name: (typeof generatorChecks)[number]) => $<HTMLInputElement>(`gen-${name}`).checked;
  return {
    length: Number(genLength.value),
    lowercase: checked('lowercase'),
    uppercase: checked('uppercase'),
    numbers: checked('numbers'),
    symbols: checked('symbols'),
  };
}

function applyGeneratedPassword(): void {
  try {
    entryPassword.value = generatePassword(readGeneratorOptions());
    entryPassword.type = 'text';
    updateEntryStrength();
    updateReuseWarning();
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

$('open-generator').addEventListener('click', () => {
  generatorBox.hidden = !generatorBox.hidden;
  if (!generatorBox.hidden) applyGeneratedPassword();
});
$('gen-apply').addEventListener('click', applyGeneratedPassword);
genLength.addEventListener('input', () => {
  $('gen-length-out').textContent = genLength.value;
  applyGeneratedPassword();
});
for (const name of generatorChecks) {
  $(`gen-${name}`).addEventListener('change', applyGeneratedPassword);
}

// ---------- trocar senha mestra ----------

const masterDialog = $<HTMLDialogElement>('master-dialog');
const masterForm = $<HTMLFormElement>('master-form');
const masterNew = $<HTMLInputElement>('master-new');
const updateMasterStrength = bindStrengthMeter(
  masterNew,
  $('master-strength-bar'),
  $('master-strength-label'),
);

$('change-master-btn').addEventListener('click', () => {
  masterForm.reset();
  updateMasterStrength();
  masterDialog.showModal();
  $('master-current').focus();
});
$('master-cancel').addEventListener('click', () => masterDialog.close());

masterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!vault) return;
  const current = $<HTMLInputElement>('master-current');
  const next = masterNew.value;
  if (next !== $<HTMLInputElement>('master-confirm').value) {
    return toast('As novas senhas não coincidem', 'error');
  }
  if (next === current.value) return toast('A nova senha é igual à atual', 'error');
  if (evaluateStrength(next).score < 2) return toast('Escolha uma senha mestra mais forte', 'error');

  const target = vault;
  await withBusy(submitButton(masterForm), 'Trocando…', async () => {
    try {
      await target.changeMasterPassword(current.value, next);
      masterForm.reset();
      masterDialog.close();
      toast('Senha mestra trocada. Exporte um backup novo.');
    } catch (err) {
      toast(errorMessage(err), 'error');
      current.select();
    }
  });
});

// ---------- backup ----------

$('export-btn').addEventListener('click', () => {
  if (!vault) return;
  const blob = new Blob([vault.exportBackup()], { type: 'application/json' });
  const link = el('a', {
    href: URL.createObjectURL(blob),
    download: `cofre-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('Backup exportado (continua criptografado)');
});

for (const input of document.querySelectorAll<HTMLInputElement>('.import-input')) {
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (Vault.exists() && !confirm('Importar este backup vai substituir o cofre atual. Continuar?')) {
      return;
    }
    try {
      Vault.importBackup(await file.text());
      lock();
      toast('Backup importado. Use a senha mestra do backup para desbloquear.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  });
}

// ---------- app instalável (PWA) ----------

/** Evento do Chrome/Edge que permite abrir o pedido de instalação a partir de um botão. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: BeforeInstallPromptEvent | null = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event as BeforeInstallPromptEvent;
  $('install-btn').hidden = false;
});

$('install-btn').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === 'accepted') toast('App instalado!');
  installPrompt = null;
  $('install-btn').hidden = true;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('install-btn').hidden = true;
});

// Só na versão publicada: no modo dev o cache atrapalharia ver as mudanças
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ---------- início ----------

$('platform-options').replaceChildren(...KNOWN_PLATFORMS.map((p) => el('option', { value: p.name })));
const typeOptions = () =>
  Object.entries(ACCOUNT_TYPES).map(([value, label]) => el('option', { value, textContent: label }));
$('entry-type').append(...typeOptions());
$('type-filter').append(...typeOptions());

showScreen(Vault.exists() ? 'unlock' : 'setup');
