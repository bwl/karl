/**
 * Setup Command — interactive wizard for LLM expansion + default preferences
 */

import type { Command } from 'commander';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import {
  loadConfig,
  saveGlobalConfig,
  saveProjectConfig,
  getGlobalConfigPath,
  getProjectConfigPath,
  type IvoConfig,
} from '../config.js';

interface ProviderTemplate {
  name: string;
  endpoint: string;
  envVar?: string;
  models: string[];
  needsKey: boolean;
}

const PROVIDERS: ProviderTemplate[] = [
  {
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    models: [
      'deepseek/deepseek-chat-v3-0324:free',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-flash',
    ],
    needsKey: true,
  },
  {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    envVar: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini'],
    needsKey: true,
  },
  {
    name: 'Local / Antigravity',
    endpoint: 'http://localhost:8317/v1',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    needsKey: false,
  },
];

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Configure LLM expansion and default preferences')
    .option('--global', 'Save to global config (~/.config/ivo/config.json)')
    .option('--project', 'Save to project config (.ivo/config.json)')
    .action(async (options) => {
      const rl = createInterface({ input, output });

      try {
        const config: IvoConfig = {};

        // Step 1 — LLM Provider
        console.log('');
        console.log('LLM provider for query expansion:');
        for (let i = 0; i < PROVIDERS.length; i++) {
          console.log(`  ${i + 1}. ${PROVIDERS[i].name}${i === 0 ? ' (recommended)' : ''}`);
        }
        console.log(`  ${PROVIDERS.length + 1}. Custom endpoint`);
        console.log(`  ${PROVIDERS.length + 2}. Skip (static expansion only)`);

        const providerChoice = await rl.question(`Select [1]: `);
        const providerIdx = parseInt(providerChoice.trim() || '1', 10) - 1;

        if (providerIdx === PROVIDERS.length + 1) {
          // Skip
          console.log('Skipping LLM configuration.');
        } else {
          config.llm = {};

          let provider: ProviderTemplate | undefined;
          if (providerIdx >= 0 && providerIdx < PROVIDERS.length) {
            provider = PROVIDERS[providerIdx];
            config.llm.endpoint = provider.endpoint;
            console.log(`Endpoint: ${provider.endpoint}`);
          } else if (providerIdx === PROVIDERS.length) {
            // Custom
            const endpoint = await rl.question('Endpoint URL: ');
            config.llm.endpoint = endpoint.trim();
            provider = {
              name: 'Custom',
              endpoint: endpoint.trim(),
              models: [],
              needsKey: true,
            };
          } else {
            // Default to first provider
            provider = PROVIDERS[0];
            config.llm.endpoint = provider.endpoint;
            console.log(`Endpoint: ${provider.endpoint}`);
          }

          // Step 2 — API Key
          if (provider.needsKey) {
            const envKey = provider.envVar ? process.env[provider.envVar] : undefined;
            if (envKey) {
              console.log(`API key: (found in ${provider.envVar})`);
            } else {
              const apiKey = await rl.question('Enter API key: ');
              if (apiKey.trim()) {
                config.llm.apiKey = apiKey.trim();
              }
            }
          }

          // Step 3 — Model
          if (provider.models.length > 0) {
            console.log('');
            console.log('Model:');
            for (let i = 0; i < provider.models.length; i++) {
              console.log(`  ${i + 1}. ${provider.models[i]}`);
            }
            console.log(`  ${provider.models.length + 1}. Enter custom model`);

            const modelChoice = await rl.question(`Select [1]: `);
            const modelIdx = parseInt(modelChoice.trim() || '1', 10) - 1;

            if (modelIdx >= 0 && modelIdx < provider.models.length) {
              config.llm.model = provider.models[modelIdx];
            } else {
              const customModel = await rl.question('Model name: ');
              if (customModel.trim()) {
                config.llm.model = customModel.trim();
              }
            }
          } else {
            const customModel = await rl.question('Model name: ');
            if (customModel.trim()) {
              config.llm.model = customModel.trim();
            }
          }

          console.log(`Model: ${config.llm.model ?? '(default)'}`);

          // Step 4 — Connection Test
          console.log('');
          console.log('Testing connection...');

          const testOk = await testConnection(
            config.llm.endpoint!,
            config.llm.model ?? 'deepseek/deepseek-chat-v3-0324:free',
            config.llm.apiKey ?? (provider.envVar ? process.env[provider.envVar] ?? '' : '')
          );

          if (!testOk) {
            const saveAnyway = await rl.question('Save anyway? (y/N): ');
            if (!/^y(es)?$/i.test(saveAnyway.trim())) {
              console.log('Aborted.');
              rl.close();
              return;
            }
          }
        }

        // Step 5 — Default Budget
        console.log('');
        const budgetInput = await rl.question('Default token budget [32000]: ');
        if (budgetInput.trim()) {
          const parsed = parseInt(budgetInput.trim(), 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            config.defaults = { ...config.defaults, budget: parsed };
          }
        }

        // Step 6 — Default Intensity
        const intensityInput = await rl.question('Default intensity (lite/standard/deep) [deep]: ');
        if (intensityInput.trim()) {
          const val = intensityInput.trim().toLowerCase();
          if (val === 'lite' || val === 'standard' || val === 'deep') {
            config.defaults = { ...config.defaults, intensity: val };
          }
        }

        // Step 7 — Default Format
        const formatInput = await rl.question('Default output format (xml/markdown/json) [xml]: ');
        if (formatInput.trim()) {
          const val = formatInput.trim().toLowerCase();
          if (val === 'xml' || val === 'markdown' || val === 'json') {
            config.defaults = { ...config.defaults, format: val };
          }
        }

        // Step 8 — Save
        rl.close();

        const isProject = options.project && !options.global;
        let savedPath: string;

        if (isProject) {
          const existing = await loadConfig();
          const merged = mergeConfigs(existing, config);
          savedPath = await saveProjectConfig(merged);
        } else {
          const existing = await loadConfig();
          const merged = mergeConfigs(existing, config);
          savedPath = await saveGlobalConfig(merged);
        }

        console.log('');
        console.log('Configuration saved:');
        if (config.llm?.endpoint) {
          console.log(`  LLM endpoint: ${config.llm.endpoint}`);
          console.log(`  LLM model:    ${config.llm.model ?? '(default)'}`);
          console.log(`  API key:      ${config.llm.apiKey ? '(saved)' : '(from env)'}`);
        }
        if (config.defaults) {
          if (config.defaults.budget) console.log(`  Budget:       ${config.defaults.budget}`);
          if (config.defaults.intensity) console.log(`  Intensity:    ${config.defaults.intensity}`);
          if (config.defaults.format) console.log(`  Format:       ${config.defaults.format}`);
        }
        console.log(`  Path:         ${savedPath}`);
      } catch (error) {
        rl.close();
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });
}

function mergeConfigs(existing: IvoConfig, incoming: IvoConfig): IvoConfig {
  const result: IvoConfig = { ...existing };
  if (incoming.llm) {
    result.llm = { ...existing.llm, ...incoming.llm };
  }
  if (incoming.defaults) {
    result.defaults = { ...existing.defaults, ...incoming.defaults };
  }
  return result;
}

async function testConnection(endpoint: string, model: string, apiKey: string): Promise<boolean> {
  try {
    const baseUrl = endpoint.replace(/\/+$/, '');
    const url = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Return exactly: ["hello"]' }],
        temperature: 0,
        max_tokens: 20,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.log(`Connection failed: ${response.status} ${response.statusText}`);
      if (text) console.log(`  ${text.slice(0, 200)}`);
      return false;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };

    const content = data.choices?.[0]?.message?.content ?? '';
    const usedModel = data.model ?? model;
    console.log(`Connection OK (model: ${usedModel}, response: ${content.slice(0, 50)})`);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`Connection failed: ${msg}`);
    return false;
  }
}
