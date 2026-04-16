/**
 * VS Code command: Configure AI provider and API key.
 */

import * as vscode from 'vscode';
import { storeApiKey, deleteApiKey, getApiKey } from '../core/secrets';

export async function executeConfigure(): Promise<void> {
  const config = vscode.workspace.getConfiguration('mergeai');
  const currentProvider = config.get<string>('aiProvider', 'openai');

  // Pick provider
  const provider = await vscode.window.showQuickPick(
    [
      { label: 'OpenAI', description: 'GPT-4o, GPT-4, etc.', value: 'openai' },
      { label: 'Anthropic', description: 'Claude 3.5, Claude 3, etc.', value: 'anthropic' },
      { label: 'Custom', description: 'Any OpenAI-compatible endpoint', value: 'custom' },
    ],
    {
      placeHolder: `Current: ${currentProvider}. Select AI provider`,
      title: 'MergeAI: Configure AI Provider',
    }
  );

  if (!provider) return;

  // Update provider setting
  await config.update('aiProvider', provider.value, vscode.ConfigurationTarget.Global);

  // Custom endpoint
  if (provider.value === 'custom') {
    const endpoint = await vscode.window.showInputBox({
      prompt: 'Enter the API endpoint URL',
      placeHolder: 'https://api.example.com/v1/chat/completions',
      value: config.get<string>('apiEndpoint', ''),
    });
    if (endpoint !== undefined) {
      await config.update('apiEndpoint', endpoint, vscode.ConfigurationTarget.Global);
    }
  }

  // Model
  const defaultModels: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
    custom: 'gpt-4o',
  };

  const model = await vscode.window.showInputBox({
    prompt: 'Enter the model name',
    placeHolder: defaultModels[provider.value] ?? 'gpt-4o',
    value: config.get<string>('model', defaultModels[provider.value] ?? 'gpt-4o'),
  });
  if (model !== undefined) {
    await config.update('model', model, vscode.ConfigurationTarget.Global);
  }

  // API Key
  const existingKey = await getApiKey(provider.value);
  const keyAction = existingKey
    ? await vscode.window.showQuickPick(
        ['Update API key', 'Keep current key', 'Remove API key'],
        { placeHolder: 'An API key is already stored.' }
      )
    : 'Update API key';

  if (keyAction === 'Update API key') {
    const apiKey = await vscode.window.showInputBox({
      prompt: `Enter your ${provider.label} API key`,
      placeHolder: 'sk-...',
      password: true,
      ignoreFocusOut: true,
    });
    if (apiKey) {
      await storeApiKey(provider.value, apiKey);
      vscode.window.showInformationMessage('MergeAI: API key stored securely.');
    }
  } else if (keyAction === 'Remove API key') {
    await deleteApiKey(provider.value);
    vscode.window.showInformationMessage('MergeAI: API key removed.');
  }

  vscode.window.showInformationMessage(
    `MergeAI: Configured to use ${provider.label} (${model ?? defaultModels[provider.value]}).`
  );
}
