# MergeAI — AI-Powered Git Merge Conflict Resolution

A production-ready VS Code extension that uses AI to intelligently resolve Git merge conflicts with full codebase context awareness and post-resolution validation.

## Features

- **Context-Aware Resolution** — Analyzes imports, functions, types, and dependencies around conflicts using `ts-morph`, not just the conflict block
- **4 Merge Strategies** — `preserve-all`, `prefer-current`, `prefer-incoming`, and `custom` (natural language instructions)
- **Validation Layer** — Runs TypeScript type checking and ESLint after resolution; warns before applying unsafe merges
- **Inline CodeLens** — "AI Resolve" buttons appear directly on conflict markers
- **Diff Preview** — Review AI-generated resolution in a side-by-side diff before applying
- **Multi-Provider Support** — OpenAI, Anthropic, or any custom OpenAI-compatible endpoint
- **Secure** — API keys stored via VS Code SecretStorage; optional warning before sending code externally
- **Confidence Scoring** — Each resolution includes a confidence level (low/medium/high) and reasoning

## Architecture

```
src/
├── extension.ts              # Entry point — registers commands, CodeLens, status bar
├── commands/
│   ├── resolveConflict.ts    # Resolve single conflict at cursor
│   ├── resolveAllConflicts.ts# Resolve all conflicts in file
│   └── configure.ts          # Configure AI provider and API key
├── core/
│   ├── types.ts              # All TypeScript interfaces and types
│   ├── conflictParser.ts     # Git conflict marker detection and parsing
│   ├── contextEngine.ts      # ts-morph based code context extraction
│   ├── aiEngine.ts           # Multi-provider AI integration layer
│   ├── mergeEngine.ts        # Orchestration pipeline
│   ├── validator.ts          # tsc + eslint post-resolution validation
│   └── secrets.ts            # Secure API key management
├── ui/
│   ├── quickPick.ts          # Strategy picker, input box, diff preview
│   └── codeLens.ts           # Inline "AI Resolve" buttons
└── test/
    ├── unit/
    │   ├── conflictParser.test.ts
    │   └── contextEngine.test.ts
    ├── integration/
    │   └── mergeFlow.test.ts
    └── runTests.ts
```

## Setup

### Prerequisites

- Node.js 18+
- VS Code 1.85+

### Install & Build

```bash
npm install
npm run compile
```

### Run in Development Mode

1. Open this repository folder in VS Code
2. Press `F5` — this launches an Extension Development Host
3. In the new VS Code window, open a project with Git merge conflicts
4. Use `Cmd+Shift+P` → "MergeAI: Configure AI Provider" to set up your API key
5. Place cursor inside a conflict → `Cmd+Shift+P` → "MergeAI: Resolve Conflict"

Or use the keyboard shortcut: `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows/Linux)

### Running Tests

```bash
npm run compile
npm run test:unit
```

For integration tests in VS Code:
1. Open the extension in VS Code
2. Use the "Extension Tests" launch configuration in the debug panel

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `mergeai.aiProvider` | `openai` | `openai`, `anthropic`, or `custom` |
| `mergeai.model` | `gpt-4o` | Model name |
| `mergeai.apiEndpoint` | — | Custom endpoint URL |
| `mergeai.contextDepth` | `2` | Dependency resolution depth (1-5) |
| `mergeai.enableValidation` | `true` | Run tsc/eslint after resolution |
| `mergeai.enableCodeLens` | `true` | Show inline resolve buttons |
| `mergeai.confirmBeforeApply` | `true` | Show diff preview |
| `mergeai.warnBeforeSending` | `true` | Warn before sending code to AI |

## Example: How a Conflict Gets Resolved

### Input (conflicted file)

```typescript
import { validateEmail } from './utils';

function createUser(name: string, email: string) {
<<<<<<< HEAD
  if (!validateEmail(email)) {
    throw new Error('Invalid email');
  }
  return { name, email };
=======
  const validated = validateEmail(email);
  if (!validated) {
    throw new Error('Email validation failed: ' + email);
  }
  return { name: name.trim(), email: email.toLowerCase() };
>>>>>>> feature/improved-validation
}
```

### Strategy: `preserve-all`

MergeAI:
1. **Parses** the conflict markers
2. **Extracts context** — finds `validateEmail` definition in `./utils`, discovers the `User` interface
3. **Sends to AI** with full context and the `preserve-all` instruction
4. **Validates** the result with `tsc --noEmit`
5. **Shows diff** for review

### Output

```typescript
  const validated = validateEmail(email);
  if (!validated) {
    throw new Error('Invalid email: ' + email);
  }
  return { name: name.trim(), email: email.toLowerCase() };
```

**Confidence:** high  
**Reasoning:** Combined improved validation pattern from incoming with error context. Both sides use validateEmail; incoming adds input normalization (trim, toLowerCase) which is strictly additive.

## Design Decisions

1. **ts-morph over raw regex** — Provides real AST analysis for accurate symbol resolution across files
2. **AST cache with TTL** — Avoids re-parsing on every conflict; 60s TTL balances freshness with performance
3. **Bottom-to-top resolution for multi-conflict** — Preserves line numbers when resolving multiple conflicts sequentially
4. **Validation is opt-out, not opt-in** — Safety by default; engineers can disable if needed
5. **Native Node.js HTTP** — Zero runtime dependencies for AI calls; keeps extension lightweight
6. **SecretStorage for API keys** — Uses VS Code's encrypted secret storage, never touches settings.json

## Packaging

```bash
npm install -g @vscode/vsce
vsce package
```

This produces `mergeai-1.0.0.vsix` which can be installed via `code --install-extension mergeai-1.0.0.vsix`.

## License

MIT
