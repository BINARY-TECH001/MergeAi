/**
 * VS Code command: Open MergeAI settings dashboard.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as vscode from 'vscode';
import { deleteApiKey, getApiKey, storeApiKey } from '../core/secrets';

type ProviderValue = 'openai' | 'anthropic' | 'gemini' | 'custom';

const PROVIDERS: Array<{ value: ProviderValue; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
];

const DEFAULT_MODELS: Record<ProviderValue, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.5-pro',
  custom: 'gpt-4o',
};

const PROVIDER_HINTS: Record<ProviderValue, string> = {
  openai:
    'OpenAI: use API keys from platform.openai.com. Default endpoint is /v1/chat/completions.',
  anthropic:
    'Anthropic: use API keys from console.anthropic.com. Default endpoint is /v1/messages.',
  gemini:
    'Gemini: use Google AI Studio key. Default endpoint is generativelanguage.googleapis.com with model-based generateContent.',
  custom:
    'Custom: use any OpenAI-compatible endpoint. Endpoint URL is required.',
};

export async function executeOpenSettings(): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'mergeai-settings-dashboard',
    'MergeAI Settings',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = getHtml(panel.webview);

  panel.webview.onDidReceiveMessage(async message => {
    switch (message?.type) {
      case 'load-state': {
        await postState(panel.webview);
        break;
      }

      case 'save-state': {
        try {
          const provider = String(message.provider ?? '') as ProviderValue;
          const model = String(message.model ?? '').trim();
          const endpoint = String(message.endpoint ?? '').trim();
          const apiKey = String(message.apiKey ?? '').trim();

          if (!PROVIDERS.some(p => p.value === provider)) {
            throw new Error('Invalid provider selected.');
          }

          const config = vscode.workspace.getConfiguration('mergeai');
          await config.update('aiProvider', provider, vscode.ConfigurationTarget.Global);
          await config.update('model', model || DEFAULT_MODELS[provider], vscode.ConfigurationTarget.Global);
          await config.update('apiEndpoint', endpoint, vscode.ConfigurationTarget.Global);

          if (apiKey) {
            await storeApiKey(provider, apiKey);
          }

          await postState(panel.webview);
          void vscode.window.showInformationMessage('MergeAI: Settings saved.');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`MergeAI: ${msg}`);
        }
        break;
      }

      case 'remove-key': {
        try {
          const provider = String(message.provider ?? '') as ProviderValue;
          if (!PROVIDERS.some(p => p.value === provider)) {
            throw new Error('Invalid provider selected.');
          }
          await deleteApiKey(provider);
          await postState(panel.webview);
          void vscode.window.showInformationMessage(`MergeAI: Removed API key for ${provider}.`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`MergeAI: ${msg}`);
        }
        break;
      }

      case 'test-connection': {
        try {
          const provider = String(message.provider ?? '') as ProviderValue;
          const model = String(message.model ?? '').trim() || DEFAULT_MODELS[provider];
          const endpoint = String(message.endpoint ?? '').trim();
          const keyFromInput = String(message.apiKey ?? '').trim();

          if (!PROVIDERS.some(p => p.value === provider)) {
            throw new Error('Invalid provider selected.');
          }

          const storedKey = await getApiKey(provider);
          const apiKey = keyFromInput || storedKey;
          if (!apiKey) {
            throw new Error('No API key available. Provide one in the field or save it first.');
          }

          const result = await testConnection({ provider, model, endpoint, apiKey });

          await panel.webview.postMessage({
            type: 'test-result',
            ok: result.ok,
            message: result.message,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          await panel.webview.postMessage({
            type: 'test-result',
            ok: false,
            message: msg,
          });
        }
        break;
      }
    }
  });
}

async function postState(webview: vscode.Webview): Promise<void> {
  const config = vscode.workspace.getConfiguration('mergeai');
  const provider = (config.get<string>('aiProvider', 'openai') as ProviderValue);
  const model = config.get<string>('model', DEFAULT_MODELS[provider] ?? 'gpt-4o') ?? 'gpt-4o';
  const endpoint = config.get<string>('apiEndpoint', '') ?? '';

  const keyState: Record<ProviderValue, boolean> = {
    openai: !!(await getApiKey('openai')),
    anthropic: !!(await getApiKey('anthropic')),
    gemini: !!(await getApiKey('gemini')),
    custom: !!(await getApiKey('custom')),
  };

  await webview.postMessage({
    type: 'state',
    provider,
    model,
    endpoint,
    providers: PROVIDERS,
    defaultModels: DEFAULT_MODELS,
    providerHints: PROVIDER_HINTS,
    hasKey: keyState,
  });
}

async function testConnection(args: {
  provider: ProviderValue;
  model: string;
  endpoint: string;
  apiKey: string;
}): Promise<{ ok: boolean; message: string }> {
  const { provider, model, endpoint, apiKey } = args;

  let url = '';
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body = '';

  switch (provider) {
    case 'openai': {
      url = endpoint || 'https://api.openai.com/v1/chat/completions';
      headers.Authorization = `Bearer ${apiKey}`;
      body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with: ok' }],
        max_tokens: 8,
        temperature: 0,
      });
      break;
    }

    case 'anthropic': {
      url = endpoint || 'https://api.anthropic.com/v1/messages';
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with: ok' }],
      });
      break;
    }

    case 'gemini': {
      const defaultUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;
      url = endpoint || defaultUrl;
      body = JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with: ok' }] }],
        generationConfig: { maxOutputTokens: 16, temperature: 0 },
      });
      break;
    }

    case 'custom': {
      if (!endpoint) {
        throw new Error('Custom provider requires an endpoint URL.');
      }
      url = endpoint;
      headers.Authorization = `Bearer ${apiKey}`;
      body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with: ok' }],
        max_tokens: 8,
        temperature: 0,
      });
      break;
    }
  }

  try {
    const text = await httpRequest(url, headers, body);
    return {
      ok: true,
      message: `Connection successful for ${provider}.` + (text ? ' API responded normally.' : ''),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Connection failed for ${provider}: ${msg}`,
    };
  }
}

function httpRequest(url: string, headers: Record<string, string>, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          resolve(text);
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error('Request timed out after 30s'));
    });
    req.write(body);
    req.end();
  });
}

function getHtml(webview: vscode.Webview): string {
  const nonce = String(Date.now());

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    body {
      margin: 0;
      padding: 18px;
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .grid {
      max-width: 760px;
      display: grid;
      gap: 12px;
    }
    .row {
      display: grid;
      gap: 6px;
    }
    label {
      font-size: 12px;
      opacity: 0.9;
      font-weight: 600;
    }
    input, select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 6px;
      padding: 8px 10px;
      outline: none;
      font: inherit;
    }
    input:focus, select:focus {
      border-color: var(--vscode-focusBorder);
    }
    .hint {
      font-size: 11px;
      opacity: 0.75;
      line-height: 1.4;
    }
    .actions {
      margin-top: 8px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button {
      border: none;
      border-radius: 7px;
      padding: 8px 12px;
      cursor: pointer;
      font: inherit;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .provider-note {
      background: color-mix(in srgb, var(--vscode-editorInfo-foreground) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-editorInfo-foreground) 35%, transparent);
      border-radius: 8px;
      padding: 10px;
      font-size: 11px;
      line-height: 1.4;
      opacity: 0.92;
    }
    .status {
      font-size: 12px;
      min-height: 18px;
    }
    .status.ok {
      color: var(--vscode-testing-iconPassed);
    }
    .status.error {
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <div class="grid">
    <div class="title">MergeAI Settings</div>
    <div class="hint">Manage provider, model, endpoint, and secure API key from one page.</div>

    <div class="row">
      <label for="provider">Provider</label>
      <select id="provider"></select>
      <div class="hint" id="provider-key-hint"></div>
    </div>

    <div class="provider-note" id="provider-note"></div>

    <div class="row">
      <label for="model">Model</label>
      <input id="model" type="text" placeholder="Model name" />
    </div>

    <div class="row">
      <label for="endpoint">Endpoint (optional override)</label>
      <input id="endpoint" type="text" placeholder="Leave empty to use provider default endpoint" />
      <div class="hint">For Gemini default, MergeAI uses Google's generateContent endpoint with your model.</div>
    </div>

    <div class="row">
      <label for="apiKey">API Key (leave empty to keep existing)</label>
      <input id="apiKey" type="password" placeholder="Paste new key only when updating" />
    </div>

    <div class="actions">
      <button id="save">Save Settings</button>
      <button id="testConnection">Test Connection</button>
      <button id="removeKey" class="secondary">Remove Key For Selected Provider</button>
    </div>
    <div class="status" id="test-status"></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const providerEl = document.getElementById('provider');
    const modelEl = document.getElementById('model');
    const endpointEl = document.getElementById('endpoint');
    const apiKeyEl = document.getElementById('apiKey');
    const saveEl = document.getElementById('save');
    const testConnectionEl = document.getElementById('testConnection');
    const removeKeyEl = document.getElementById('removeKey');
    const providerKeyHintEl = document.getElementById('provider-key-hint');
    const providerNoteEl = document.getElementById('provider-note');
    const testStatusEl = document.getElementById('test-status');

    let state = null;

    const refreshProviderHint = () => {
      if (!state) return;
      const selected = providerEl.value;
      const hasKey = !!state.hasKey[selected];
      providerKeyHintEl.textContent = hasKey
        ? 'An API key is stored for this provider.'
        : 'No API key stored for this provider yet.';

      providerNoteEl.textContent = state.providerHints[selected] || '';

      if (!modelEl.value) {
        modelEl.value = state.defaultModels[selected] || '';
      }
    };

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'test-result') {
        testStatusEl.className = message.ok ? 'status ok' : 'status error';
        testStatusEl.textContent = message.message || '';
        testConnectionEl.disabled = false;
        return;
      }

      if (message.type !== 'state') return;

      state = message;
      providerEl.innerHTML = '';
      for (const p of state.providers) {
        const opt = document.createElement('option');
        opt.value = p.value;
        opt.textContent = p.label;
        providerEl.appendChild(opt);
      }

      providerEl.value = state.provider;
      modelEl.value = state.model || '';
      endpointEl.value = state.endpoint || '';
      apiKeyEl.value = '';
      testStatusEl.textContent = '';
      testStatusEl.className = 'status';
      refreshProviderHint();
    });

    providerEl.addEventListener('change', () => {
      refreshProviderHint();
      if (state && state.defaultModels[providerEl.value]) {
        modelEl.value = state.defaultModels[providerEl.value];
      }
    });

    saveEl.addEventListener('click', () => {
      vscode.postMessage({
        type: 'save-state',
        provider: providerEl.value,
        model: modelEl.value,
        endpoint: endpointEl.value,
        apiKey: apiKeyEl.value,
      });
      apiKeyEl.value = '';
    });

    testConnectionEl.addEventListener('click', () => {
      testConnectionEl.disabled = true;
      testStatusEl.className = 'status';
      testStatusEl.textContent = 'Testing connection...';
      vscode.postMessage({
        type: 'test-connection',
        provider: providerEl.value,
        model: modelEl.value,
        endpoint: endpointEl.value,
        apiKey: apiKeyEl.value,
      });
    });

    removeKeyEl.addEventListener('click', () => {
      vscode.postMessage({ type: 'remove-key', provider: providerEl.value });
      apiKeyEl.value = '';
    });

    vscode.postMessage({ type: 'load-state' });
  </script>
</body>
</html>`;
}
