/**
 * Secure API key storage using VS Code SecretStorage.
 */

import * as vscode from 'vscode';
import { AIProviderConfig } from './types';

const SECRET_KEY_PREFIX = 'mergeai.apiKey.';

let secretStorage: vscode.SecretStorage | undefined;

export function initSecretStorage(context: vscode.ExtensionContext): void {
  secretStorage = context.secrets;
}

/**
 * Store an API key securely.
 */
export async function storeApiKey(provider: string, key: string): Promise<void> {
  if (!secretStorage) throw new Error('Secret storage not initialized');
  await secretStorage.store(`${SECRET_KEY_PREFIX}${provider}`, key);
}

/**
 * Retrieve an API key.
 */
export async function getApiKey(provider: string): Promise<string | undefined> {
  if (!secretStorage) throw new Error('Secret storage not initialized');
  return secretStorage.get(`${SECRET_KEY_PREFIX}${provider}`);
}

/**
 * Delete a stored API key.
 */
export async function deleteApiKey(provider: string): Promise<void> {
  if (!secretStorage) throw new Error('Secret storage not initialized');
  await secretStorage.delete(`${SECRET_KEY_PREFIX}${provider}`);
}

/**
 * Build AIProviderConfig from VS Code settings + stored secrets.
 */
export async function getAIConfig(): Promise<AIProviderConfig> {
  const config = vscode.workspace.getConfiguration('mergeai');
  const provider = config.get<string>('aiProvider', 'openai') as AIProviderConfig['provider'];
  const model = config.get<string>('model', 'gpt-4o');
  const endpoint = config.get<string>('apiEndpoint', '');

  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `No API key configured for "${provider}". Run "MergeAI: Configure AI Provider" to set up.`
    );
  }

  return {
    provider,
    apiKey,
    model,
    endpoint: endpoint || undefined,
  };
}
