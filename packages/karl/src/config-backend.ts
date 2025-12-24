import type { StackConfig } from './types.js';
import { addModel, editModel, removeModel, setDefaultModel } from './commands/models.js';
import { addProvider, editProvider, loginProvider, logoutProvider, removeProvider } from './commands/providers.js';
import { createStack, editStack, removeStack, updateStack } from './commands/stacks.js';

export interface ConfigBackend {
  addModel: typeof addModel;
  editModel: typeof editModel;
  removeModel: typeof removeModel;
  setDefaultModel: typeof setDefaultModel;
  addProvider: typeof addProvider;
  editProvider: typeof editProvider;
  removeProvider: typeof removeProvider;
  loginProvider: typeof loginProvider;
  logoutProvider: typeof logoutProvider;
  createStack: typeof createStack;
  editStack: typeof editStack;
  removeStack: typeof removeStack;
  updateStack: (name: string, changes: Partial<StackConfig>, clearFields?: Set<keyof StackConfig>) => Promise<void>;
}

export function createDefaultBackend(): ConfigBackend {
  return {
    addModel,
    editModel,
    removeModel,
    setDefaultModel,
    addProvider,
    editProvider,
    removeProvider,
    loginProvider,
    logoutProvider,
    createStack,
    editStack,
    removeStack,
    updateStack: async (name, changes, clearFields) => {
      await updateStack(name, { changes, clearFields });
    },
  };
}
