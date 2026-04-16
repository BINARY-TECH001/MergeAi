/**
 * Validation layer for resolved merge conflicts.
 *
 * Runs TypeScript type checking and ESLint to verify the resolved
 * code doesn't introduce errors.
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ValidationResult, ValidationError, ValidationWarning } from './types';

const TIMEOUT_MS = 30_000;

/**
 * Validate resolved file content using available tools.
 */
export async function validate(
  newContent: string,
  originalFilePath: string,
  workspaceRoot: string
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Write to a temp file for validation
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mergeai-'));
  const ext = path.extname(originalFilePath);
  const tempFile = path.join(tempDir, `validate${ext}`);

  try {
    fs.writeFileSync(tempFile, newContent, 'utf-8');

    // Run TypeScript check
    const tsErrors = await runTypeScriptCheck(tempFile, workspaceRoot);
    errors.push(...tsErrors.errors);
    warnings.push(...tsErrors.warnings);

    // Run ESLint check
    const eslintResult = await runESLintCheck(tempFile, workspaceRoot);
    errors.push(...eslintResult.errors);
    warnings.push(...eslintResult.warnings);
  } finally {
    // Cleanup
    try {
      fs.unlinkSync(tempFile);
      fs.rmdirSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Run `tsc --noEmit` on the file.
 */
async function runTypeScriptCheck(
  filePath: string,
  workspaceRoot: string
): Promise<{ errors: ValidationError[]; warnings: ValidationWarning[] }> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check if tsconfig exists
  const tsconfigPath = path.join(workspaceRoot, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    return { errors, warnings };
  }

  // Try to find tsc
  const tscPaths = [
    path.join(workspaceRoot, 'node_modules', '.bin', 'tsc'),
    'tsc',
  ];

  let tscPath: string | null = null;
  for (const p of tscPaths) {
    try {
      await execCommand(`${p} --version`, workspaceRoot);
      tscPath = p;
      break;
    } catch {
      continue;
    }
  }

  if (!tscPath) return { errors, warnings };

  try {
    const result = await execCommand(
      `${tscPath} --noEmit --pretty false "${filePath}" 2>&1`,
      workspaceRoot
    );
    // tsc exits 0 if no errors
    return { errors, warnings };
  } catch (err: unknown) {
    const output = (err as { stdout?: string }).stdout ?? String(err);
    const lines = output.split('\n').filter(Boolean);

    for (const line of lines) {
      const match = line.match(/\((\d+),(\d+)\):\s*(error|warning)\s+TS\d+:\s*(.+)/);
      if (match) {
        const entry = {
          message: match[4],
          line: parseInt(match[1], 10),
          column: parseInt(match[2], 10),
          source: 'typescript' as const,
        };
        if (match[3] === 'error') {
          errors.push(entry);
        } else {
          warnings.push(entry);
        }
      }
    }

    return { errors, warnings };
  }
}

/**
 * Run ESLint on the file.
 */
async function runESLintCheck(
  filePath: string,
  workspaceRoot: string
): Promise<{ errors: ValidationError[]; warnings: ValidationWarning[] }> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const eslintPaths = [
    path.join(workspaceRoot, 'node_modules', '.bin', 'eslint'),
    'eslint',
  ];

  let eslintPath: string | null = null;
  for (const p of eslintPaths) {
    try {
      await execCommand(`${p} --version`, workspaceRoot);
      eslintPath = p;
      break;
    } catch {
      continue;
    }
  }

  if (!eslintPath) return { errors, warnings };

  try {
    const result = await execCommand(
      `${eslintPath} --format json "${filePath}" 2>/dev/null`,
      workspaceRoot
    );

    const parsed = JSON.parse(result);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const messages = parsed[0].messages ?? [];
      for (const msg of messages) {
        const entry = {
          message: msg.message,
          line: msg.line,
          column: msg.column,
          source: 'eslint' as const,
        };
        if (msg.severity === 2) {
          errors.push(entry);
        } else {
          warnings.push(entry);
        }
      }
    }
  } catch {
    // ESLint not available or failed — non-blocking
  }

  return { errors, warnings };
}

/**
 * Execute a shell command and return stdout.
 */
function execCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject({ ...error, stdout: stdout?.toString(), stderr: stderr?.toString() });
      } else {
        resolve(stdout?.toString() ?? '');
      }
    });
  });
}
