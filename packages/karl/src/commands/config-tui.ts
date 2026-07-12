import { createInterface } from 'readline';
import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
  type KeyEvent,
  type SelectOption,
} from '@opentui/core';
import { createDefaultBackend } from '../config-backend.js';
import { formatError } from '../utils.js';
import {
  CONFIG_CATEGORIES,
  filterConfigActions,
  getConfigActions,
  loadConfigTuiData,
  type ConfigAction,
  type ConfigCategoryId,
  type ConfigTuiData,
} from './config-tui-data.js';

const COLORS = {
  background: '#09100c',
  panel: '#101812',
  panelActive: '#1a271e',
  line: '#314138',
  ink: '#e8eadf',
  muted: '#8f998d',
  faint: '#526057',
  court: '#73d09a',
  ball: '#d9ee68',
  red: '#ef8585',
};

type FocusArea = 'sidebar' | 'filter' | 'actions';

function categoryOptions(data: ConfigTuiData): SelectOption[] {
  const counts: Partial<Record<ConfigCategoryId, number>> = {
    models: data.models.length,
    providers: data.providers.length,
    stacks: data.stacks.length,
  };
  return CONFIG_CATEGORIES.map(category => ({
    name: counts[category.id] === undefined
      ? category.name
      : `${category.name}  ${counts[category.id]}`,
    description: '',
    value: category.id,
  }));
}

function actionOptions(actions: ConfigAction[]): SelectOption[] {
  return actions.map(action => ({
    name: action.shortcut ? `${action.name}  [${action.shortcut}]` : action.name,
    description: action.description,
    value: action.id,
  }));
}

function readyProviderCount(data: ConfigTuiData): number {
  return data.providers.filter(provider => !/(missing|not logged in|refresh needed)/i.test(provider.auth)).length;
}

function askLine(prompt: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    readline.question(prompt, answer => {
      readline.close();
      resolve(answer.trim());
    });
  });
}

function waitForEnter(): Promise<void> {
  return askLine('\nPress Enter to return to Karl Config...').then(() => undefined);
}

export async function launchOpenTuiConfig(): Promise<void> {
  const cwd = process.cwd();
  const backend = createDefaultBackend();
  let data = await loadConfigTuiData(cwd);
  let category: ConfigCategoryId = 'common';
  let actions = getConfigActions(data, category);
  let focusArea: FocusArea = 'actions';
  let busy = false;

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
  });
  renderer.setTerminalTitle('Karl Config');
  renderer.setBackgroundColor(COLORS.background);

  const root = new BoxRenderable(renderer, {
    id: 'config-root',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: COLORS.background,
  });
  renderer.root.add(root);

  const top = new BoxRenderable(renderer, {
    id: 'top',
    height: 3,
    paddingX: 2,
    alignItems: 'center',
    flexDirection: 'row',
    backgroundColor: COLORS.panel,
    border: ['bottom'],
    borderColor: COLORS.line,
  });
  root.add(top);
  top.add(new TextRenderable(renderer, {
    id: 'brand',
    content: 'KARL  /  CONFIG',
    fg: COLORS.ball,
    attributes: 1,
    flexGrow: 1,
    height: 1,
  }));
  const health = new TextRenderable(renderer, {
    id: 'health',
    content: '● configuration loaded',
    fg: COLORS.court,
    width: 23,
    height: 1,
  });
  top.add(health);

  const body = new BoxRenderable(renderer, {
    id: 'body',
    flexGrow: 1,
    minHeight: 0,
    flexDirection: 'row',
    backgroundColor: COLORS.background,
  });
  root.add(body);

  const sidebar = new BoxRenderable(renderer, {
    id: 'sidebar',
    width: 25,
    minWidth: 20,
    flexDirection: 'column',
    padding: 1,
    backgroundColor: COLORS.panel,
    border: ['right'],
    borderColor: COLORS.line,
  });
  body.add(sidebar);
  sidebar.add(new TextRenderable(renderer, {
    id: 'court-label',
    content: 'ONE COURT\nConfiguration',
    fg: COLORS.muted,
    height: 3,
    marginBottom: 1,
  }));
  const categorySelect = new SelectRenderable(renderer, {
    id: 'categories',
    options: categoryOptions(data),
    flexGrow: 1,
    minHeight: 6,
    showDescription: false,
    showScrollIndicator: false,
    showSelectionIndicator: true,
    backgroundColor: COLORS.panel,
    textColor: COLORS.muted,
    selectedBackgroundColor: COLORS.panelActive,
    selectedTextColor: COLORS.ink,
    focusedBackgroundColor: COLORS.panel,
    focusedTextColor: COLORS.ink,
  });
  sidebar.add(categorySelect);
  const sidebarHealth = new TextRenderable(renderer, {
    id: 'sidebar-health',
    content: `${readyProviderCount(data)}/${data.providers.length} providers ready\n${data.models.length} models available`,
    fg: COLORS.faint,
    height: 3,
    marginTop: 1,
  });
  sidebar.add(sidebarHealth);

  const main = new BoxRenderable(renderer, {
    id: 'main',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: 'column',
    backgroundColor: COLORS.background,
  });
  body.add(main);

  const filterBox = new BoxRenderable(renderer, {
    id: 'filter-box',
    height: 3,
    margin: 1,
    marginBottom: 0,
    paddingX: 1,
    alignItems: 'center',
    flexDirection: 'row',
    border: true,
    borderColor: COLORS.line,
    focusedBorderColor: COLORS.court,
    backgroundColor: COLORS.panel,
  });
  main.add(filterBox);
  filterBox.add(new TextRenderable(renderer, {
    id: 'filter-slash',
    content: '/ ',
    fg: COLORS.faint,
    width: 2,
    height: 1,
  }));
  const filter = new InputRenderable(renderer, {
    id: 'filter',
    flexGrow: 1,
    value: '',
    placeholder: 'Filter options',
    textColor: COLORS.ink,
    backgroundColor: COLORS.panel,
    cursorColor: COLORS.ball,
  });
  filterBox.add(filter);

  const actionSelect = new SelectRenderable(renderer, {
    id: 'actions',
    options: actionOptions(actions),
    flexGrow: 1,
    minHeight: 0,
    margin: 1,
    itemSpacing: 1,
    showDescription: true,
    showScrollIndicator: true,
    showSelectionIndicator: true,
    backgroundColor: COLORS.background,
    textColor: COLORS.ink,
    descriptionColor: COLORS.muted,
    selectedBackgroundColor: COLORS.panelActive,
    selectedTextColor: COLORS.ink,
    selectedDescriptionColor: COLORS.muted,
    focusedBackgroundColor: COLORS.background,
    focusedTextColor: COLORS.ink,
  });
  main.add(actionSelect);

  const footer = new BoxRenderable(renderer, {
    id: 'footer',
    height: 3,
    paddingX: 2,
    alignItems: 'center',
    flexDirection: 'row',
    backgroundColor: COLORS.panel,
    border: ['top'],
    borderColor: COLORS.line,
  });
  root.add(footer);
  const hints = new TextRenderable(renderer, {
    id: 'hints',
    content: 'j/k move   enter choose   / filter   ? help   q leave the court',
    fg: COLORS.muted,
    flexGrow: 1,
    height: 1,
  });
  footer.add(hints);
  const status = new TextRenderable(renderer, {
    id: 'status',
    content: '',
    fg: COLORS.court,
    width: 30,
    height: 1,
    truncate: true,
  });
  footer.add(status);

  const setStatus = (message: string, error = false) => {
    status.content = message;
    status.fg = error ? COLORS.red : COLORS.court;
  };

  const focus = (area: FocusArea) => {
    focusArea = area;
    if (area === 'sidebar') categorySelect.focus();
    if (area === 'filter') filter.focus();
    if (area === 'actions') actionSelect.focus();
  };

  const refreshActions = (preserveSelection = true) => {
    const previous = preserveSelection ? actionSelect.getSelectedOption()?.value as string | undefined : undefined;
    actions = filterConfigActions(getConfigActions(data, category), filter.value);
    actionSelect.options = actionOptions(actions);
    const nextIndex = previous ? actions.findIndex(action => action.id === previous) : 0;
    actionSelect.setSelectedIndex(Math.max(0, nextIndex));
    if (actions.length === 0) setStatus('No matching options', true);
    else if (status.plainText === 'No matching options') setStatus('');
  };

  const changeCategory = (next: ConfigCategoryId) => {
    category = next;
    filter.value = '';
    refreshActions(false);
    setStatus('');
  };

  const refreshData = async () => {
    data = await loadConfigTuiData(cwd);
    categorySelect.options = categoryOptions(data);
    categorySelect.setSelectedIndex(CONFIG_CATEGORIES.findIndex(item => item.id === category));
    sidebarHealth.content = `${readyProviderCount(data)}/${data.providers.length} providers ready\n${data.models.length} models available`;
    refreshActions(true);
  };

  const suspendFor = async (action: () => Promise<void>, pauseAfter = false) => {
    if (busy) return;
    busy = true;
    renderer.suspend();
    try {
      await action();
    } catch (error) {
      console.error(formatError(error));
      pauseAfter = true;
    }
    if (pauseAfter) await waitForEnter();
    await refreshData();
    renderer.resume();
    focus('actions');
    setStatus('Configuration refreshed');
    busy = false;
  };

  const selectedAction = (): ConfigAction | undefined => {
    const id = actionSelect.getSelectedOption()?.value as string | undefined;
    return actions.find(action => action.id === id);
  };

  const addModel = async () => suspendFor(async () => {
    const alias = await askLine('Model alias: ');
    if (alias) await backend.addModel({ alias });
  }, true);

  const addStack = async () => suspendFor(async () => {
    const name = await askLine('Stack name: ');
    if (name) await backend.createStack(name, { global: false });
  }, true);

  const runDoctor = async () => suspendFor(async () => {
    const { diagnoseConfig, printConfigDoctorReport } = await import('../config-doctor.js');
    printConfigDoctorReport(await diagnoseConfig(cwd));
  }, true);

  const activate = async (action = selectedAction()) => {
    if (!action) return;
    const [kind, name] = action.id.split(':', 2);
    if (action.id === 'common:default') {
      changeCategory('models');
      categorySelect.setSelectedIndex(CONFIG_CATEGORIES.findIndex(item => item.id === 'models'));
      setStatus('Choose a model, then press s');
      return;
    }
    if (action.id === 'common:add-model' || action.id === 'models:add') return addModel();
    if (action.id === 'common:add-provider' || action.id === 'providers:add') {
      return suspendFor(() => backend.addProvider(), true);
    }
    if (action.id === 'common:add-stack' || action.id === 'stacks:add') return addStack();
    if (action.id === 'common:doctor') return runDoctor();
    if (action.id === 'runtime:edit-global' || action.id === 'files:global') {
      return suspendFor(() => backendEditConfig(data.paths.globalPath), false);
    }
    if (action.id === 'runtime:edit-project' || action.id === 'files:project') {
      return suspendFor(() => backendEditConfig(data.paths.projectPath), false);
    }
    if (kind === 'model' && name) return suspendFor(() => backend.editModel(name), false);
    if (kind === 'provider' && name) return suspendFor(() => backend.editProvider(name), false);
    if (kind === 'stack' && name) return suspendFor(() => backend.editStack(name), false);
    setStatus('This row is informational');
  };

  const backendEditConfig = async (filePath: string) => {
    const { existsSync, mkdirSync, writeFileSync } = await import('fs');
    const { dirname } = await import('path');
    const { spawnSync } = await import('child_process');
    if (!existsSync(filePath)) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, '{}\n');
    }
    const editor = process.env.EDITOR || process.env.VISUAL;
    if (!editor) {
      console.log(`File: ${filePath}\nSet $EDITOR to open it automatically.`);
      await waitForEnter();
      return;
    }
    spawnSync(editor, [filePath], { stdio: 'inherit' });
  };

  const removeSelected = async () => {
    const action = selectedAction();
    if (!action) return;
    const [kind, name] = action.id.split(':', 2);
    if (!name || !['model', 'provider', 'stack'].includes(kind)) return;
    await suspendFor(async () => {
      const answer = (await askLine(`Remove ${kind} "${name}"? [y/N] `)).toLowerCase();
      if (answer !== 'y' && answer !== 'yes') return;
      if (kind === 'model') await backend.removeModel(name);
      if (kind === 'provider') await backend.removeProvider(name);
      if (kind === 'stack') await backend.removeStack(name);
    }, true);
  };

  const setDefault = async () => {
    const action = selectedAction();
    if (!action?.id.startsWith('model:')) return;
    await suspendFor(() => backend.setDefaultModel(action.id.slice('model:'.length)), false);
  };

  const providerSession = async (login: boolean) => {
    const action = selectedAction();
    if (!action?.id.startsWith('provider:')) return;
    const key = action.id.slice('provider:'.length);
    await suspendFor(() => login ? backend.loginProvider(key) : backend.logoutProvider(key), true);
  };

  categorySelect.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: SelectOption) => {
    changeCategory(option.value as ConfigCategoryId);
    focus('actions');
  });
  actionSelect.on(SelectRenderableEvents.ITEM_SELECTED, () => void activate());
  filter.on(InputRenderableEvents.INPUT, () => refreshActions(false));
  filter.on(InputRenderableEvents.ENTER, () => focus('actions'));

  const exitPromise = new Promise<void>(resolve => {
    const exit = () => {
      renderer.destroy();
      resolve();
    };
    renderer.keyInput.on('keypress', (key: KeyEvent) => {
      if (busy || key.eventType === 'release') return;
      if (key.ctrl && key.name === 'c') return exit();
      if (focusArea === 'filter') {
        if (key.name === 'escape' || key.name === 'esc') {
          filter.value = '';
          refreshActions(false);
          focus('actions');
          key.preventDefault();
        }
        if (key.name === 'tab') {
          focus('actions');
          key.preventDefault();
        }
        return;
      }
      if (key.name === 'q') return exit();
      if (key.name === '/') {
        focus('filter');
        key.preventDefault();
        return;
      }
      if (key.name === 'tab') {
        focus(focusArea === 'sidebar' ? 'actions' : 'sidebar');
        key.preventDefault();
        return;
      }
      if (key.name === 'left' || key.name === 'h') {
        focus('sidebar');
        key.preventDefault();
        return;
      }
      if ((key.name === 'right' || key.name === 'l') && focusArea === 'sidebar') {
        focus('actions');
        key.preventDefault();
        return;
      }
      if (focusArea === 'sidebar') return;
      if (key.name === 'a' && category !== 'common') void activate(getConfigActions(data, category)[0]);
      if (key.name === 'm' && category === 'common') void addModel();
      if (key.name === 'n' && category === 'common') void addStack();
      if (key.name === 'd') {
        if (category === 'common') void runDoctor();
        else void removeSelected();
      }
      if (key.name === 's') {
        if (category === 'common') void activate(getConfigActions(data, category)[0]);
        else void setDefault();
      }
      if (key.name === 'L' || (key.shift && key.name === 'l')) void providerSession(true);
      if (key.name === 'o') void providerSession(false);
      if (key.name === 'g') void suspendFor(() => backendEditConfig(data.paths.globalPath), false);
      if (key.name === 'p') {
        if (category === 'common') void suspendFor(() => backend.addProvider(), true);
        if (category === 'files' || category === 'runtime') void suspendFor(() => backendEditConfig(data.paths.projectPath), false);
      }
      if (key.name === '?') setStatus('←/→ panes · a add · d remove · s default · L login · o logout');
    });
  });

  focus('actions');
  renderer.start();
  await exitPromise;
}
