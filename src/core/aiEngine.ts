/**
 * AI integration engine for merge conflict resolution.
 *
 * Supports OpenAI, Anthropic, Gemini, and custom API endpoints.
 * Constructs context-rich prompts and parses structured responses.
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import {
  MergeRequest,
  MergeResult,
  AIProviderConfig,
  ConfidenceLevel,
  MergeStrategy,
} from './types';

/**
 * Resolve a merge conflict using the configured AI provider.
 */
export async function resolveWithAI(
  request: MergeRequest,
  config: AIProviderConfig
): Promise<MergeResult> {
  const prompt = buildPrompt(request);
  const systemPrompt = buildSystemPrompt();

  const rawResponse = await callAI(systemPrompt, prompt, config);
  return parseResponse(rawResponse, request.strategy);
}

/**
 * Build the system prompt that instructs the AI how to respond.
 */
function buildSystemPrompt(): string {
  return `You are an expert software engineer specializing in Git merge conflict resolution.
Your task is to resolve merge conflicts intelligently while maintaining code correctness.

RULES:
1. Output ONLY valid code — no conflict markers, no markdown fences.
2. Preserve all necessary imports, types, and function signatures.
3. Do not introduce duplicate code.
4. Ensure the resolved code is compatible with the surrounding codebase context.
5. Maintain consistent formatting with the existing code.

RESPONSE FORMAT (strict JSON):
{
  "resolvedCode": "<the merged code that replaces the conflict block>",
  "reasoning": "<brief explanation of merge decisions, max 3 sentences>",
  "confidence": "<low|medium|high>"
}

Confidence guidelines:
- "high": straightforward merge, no ambiguity
- "medium": some interpretation needed, but result is likely correct
- "low": significant ambiguity, manual review recommended`;
}

/**
 * Build the user prompt with conflict details and context.
 */
function buildPrompt(request: MergeRequest): string {
  const { conflict, strategy, customInstruction, context, filePath, languageId } = request;

  let strategyInstruction: string;
  switch (strategy) {
    case 'preserve-all':
      strategyInstruction =
        'Merge BOTH sides intelligently. Combine logic from current and incoming, avoid duplication, ensure compatibility.';
      break;
    case 'prefer-current':
      strategyInstruction =
        'Keep the CURRENT (HEAD) changes. Only incorporate incoming changes if they don\'t conflict with current logic.';
      break;
    case 'prefer-incoming':
      strategyInstruction =
        'Keep the INCOMING changes. Only retain current changes if they don\'t conflict with incoming logic.';
      break;
    case 'custom':
      strategyInstruction = `Custom instruction: ${customInstruction ?? 'Merge intelligently based on your judgment.'}`;
      break;
  }

  const contextSection = buildContextSection(context);

  return `## Merge Conflict Resolution

**File:** ${filePath} (${languageId})
**Strategy:** ${strategy}
**Instruction:** ${strategyInstruction}

### Current (HEAD — ${conflict.currentBranch})
\`\`\`${languageId}
${conflict.currentContent}
\`\`\`

### Incoming (${conflict.incomingBranch})
\`\`\`${languageId}
${conflict.incomingContent}
\`\`\`

${contextSection}

Resolve this conflict following the strategy above. Return your response as the specified JSON format.`;
}

/**
 * Build a context section from extracted code context.
 */
function buildContextSection(context: import('./types').CodeContext): string {
  const sections: string[] = [];

  if (context.imports.length > 0) {
    const importList = context.imports
      .map(i => {
        const names = [i.defaultImport, ...i.namedImports].filter(Boolean).join(', ');
        return `  - ${names} from "${i.moduleSpecifier}"${i.isTypeOnly ? ' (type-only)' : ''}`;
      })
      .join('\n');
    sections.push(`### Imports\n${importList}`);
  }

  if (context.types.length > 0) {
    const typeList = context.types
      .map(t => `\`\`\`typescript\n${t.definition}\n\`\`\``)
      .join('\n');
    sections.push(`### Referenced Types\n${typeList}`);
  }

  if (context.functions.length > 0) {
    const fnList = context.functions
      .map(f => `\`\`\`typescript\n// ${f.name} (${f.filePath})\n${f.body}\n\`\`\``)
      .join('\n');
    sections.push(`### Referenced Functions\n${fnList}`);
  }

  if (context.surroundingCode) {
    sections.push(`### Surrounding Code\n\`\`\`\n${context.surroundingCode}\n\`\`\``);
  }

  return sections.length > 0
    ? `### Codebase Context\n${context.summary}\n\n${sections.join('\n\n')}`
    : '### Codebase Context\nNo additional context available.';
}

/**
 * Call the AI provider API.
 */
async function callAI(
  systemPrompt: string,
  userPrompt: string,
  config: AIProviderConfig
): Promise<string> {
  const { provider, apiKey, model, endpoint } = config;

  let url: string;
  let headers: Record<string, string>;
  let body: string;

  switch (provider) {
    case 'openai': {
      url = endpoint || 'https://api.openai.com/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      body = JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });
      break;
    }

    case 'anthropic': {
      url = endpoint || 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      break;
    }

    case 'custom': {
      if (!endpoint) throw new Error('Custom AI provider requires an endpoint URL');
      url = endpoint;
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      body = JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 4096,
      });
      break;
    }

    case 'gemini': {
      const defaultUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;
      url = endpoint || defaultUrl;
      headers = {
        'Content-Type': 'application/json',
      };
      body = JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      });
      break;
    }
  }

  const responseText = await httpRequest(url, 'POST', headers, body);
  return extractContent(responseText, provider);
}

/**
 * Extract the text content from provider-specific response formats.
 */
function extractContent(responseText: string, provider: string): string {
  const parsed = JSON.parse(responseText);

  if (provider === 'anthropic') {
    const block = parsed.content?.[0];
    if (block?.type === 'text') return block.text;
    throw new Error('Unexpected Anthropic response format');
  }

  if (provider === 'gemini') {
    const text = parsed.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? '')
      .join('')
      .trim();
    if (text) return text;
    throw new Error('Unexpected Gemini response format');
  }

  // OpenAI / custom
  const choice = parsed.choices?.[0];
  if (choice?.message?.content) return choice.message.content;
  throw new Error('Unexpected API response format');
}

/**
 * Parse the AI response into a structured MergeResult.
 */
function parseResponse(raw: string, strategy: MergeStrategy): MergeResult {
  // Try JSON parse first
  try {
    const parsed = JSON.parse(raw);
    return {
      resolvedCode: parsed.resolvedCode?.trim() ?? '',
      reasoning: parsed.reasoning?.trim() ?? 'No reasoning provided.',
      confidence: validateConfidence(parsed.confidence),
      strategy,
    };
  } catch {
    // Fallback: try to extract JSON from the response
    const jsonMatch = raw.match(/\{[\s\S]*"resolvedCode"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          resolvedCode: parsed.resolvedCode?.trim() ?? '',
          reasoning: parsed.reasoning?.trim() ?? 'No reasoning provided.',
          confidence: validateConfidence(parsed.confidence),
          strategy,
        };
      } catch {
        // Fall through
      }
    }

    // Last resort: treat entire response as resolved code
    return {
      resolvedCode: raw.trim(),
      reasoning: 'AI response was not in expected format. Treating raw output as resolved code.',
      confidence: 'low',
      strategy,
    };
  }
}

function validateConfidence(value: unknown): ConfidenceLevel {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
}

/**
 * Low-level HTTP(S) request helper. No external dependencies.
 */
function httpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`AI API error (${res.statusCode}): ${text.slice(0, 500)}`));
        } else {
          resolve(text);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60_000, () => {
      req.destroy(new Error('AI API request timed out after 60s'));
    });
    req.write(body);
    req.end();
  });
}
