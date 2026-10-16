import './style.css';
import { Vault, type Entry, type EntryInput } from './vault';
import { generatePassword, type GeneratorOptions } from './generator';
import { evaluateStrength } from './strength';
import { generateTotp, parseTotp, secondsRemaining, type TotpConfig } from './totp';

const AUTO_LOCK_MS = 5 * 60 * 1000;
const CLIPBOARD_CLEAR_MS = 30 * 1000;

let vault: Vault | null = null;
let editingId: string | null = null;
let lockTimer: number | undefined;
let clipboardTimer: number | undefined;
let toastTimer: number | undefined;
let totpTimer: number | undefined;
let onlyReused = false;

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
  $('entry-list').replaceChildren();
  $<HTMLInputElement>('search').value = '';
  $<HTMLSelectElement>('platform-filter').value = '';
  onlyReused = false;
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
    '🔐 ',
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
    .search($<HTMLInputElement>('search').value, $<HTMLSelectElement>('platform-filter').value)
    .filter((e) => !onlyReused || reused.has(e.id));
  $('entry-list').replaceChildren(...items.map((e) => renderEntry(e, reused.get(e.id))));
  startTotpTicker();

  const empty = $('empty-state');
  empty.hidden = items.length > 0;
  empty.textContent =
    vault.entries.length === 0
      ? 'Nenhuma conta de jogo salva ainda. Clique em "+ Nova conta" para começar.'
      : 'Nenhum resultado para a busca.';
}

function renderEntry(entry: Entry, reuseCount?: number): HTMLLIElement {
  const title = isSafeUrl(entry.url)
    ? el('a', { href: entry.url, target: '_blank', rel: 'noopener noreferrer', textContent: entry.site })
    : el('span', { textContent: entry.site });

  const action = (text: string, onclick: () => void, extraClass = '') =>
    el('button', { type: 'button', className: `btn ghost small ${extraClass}`, textContent: text, onclick });

  const heading = el('strong', {}, title);
  if (entry.platform) heading.append(' ', el('span', { className: 'badge', textContent: entry.platform }));

  const details = [entry.server, entry.rank].filter(Boolean).join(' · ');

  return el(
    'li',
    { className: 'entry' },
    el('div', { className: 'entry-avatar', textContent: entry.site.charAt(0).toUpperCase() }),
    el(
      'div',
      { className: 'entry-main' },
      heading,
      el('span', { textContent: entry.nickname ? `🎮 ${entry.nickname}` : '' }),
      el('span', { className: 'muted', textContent: `Login: ${entry.username}` }),
      el('small', { className: 'muted', textContent: details }),
      reuseCount
        ? el('small', { className: 'danger', textContent: `⚠ Senha repetida em ${reuseCount} contas` })
        : '',
      renderTotp(entry) ?? '',
    ),
    el(
      'div',
      { className: 'entry-actions' },
      action('Copiar login', () => copyToClipboard(entry.username, 'Login copiado')),
      action('Copiar senha', () => copyToClipboard(entry.password, 'Senha copiada — será apagada em 30s', true)),
      action('Editar', () => openEntryDialog(entry)),
      action('Excluir', () => deleteEntry(entry), 'danger'),
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
    platform: field('platform').trim(),
    nickname: field('nickname').trim(),
    server: field('server').trim(),
    rank: field('rank').trim(),
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

// ---------- início ----------

showScreen(Vault.exists() ? 'unlock' : 'setup');
