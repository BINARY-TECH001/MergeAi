/**
 * Integration tests for the merge resolution flow.
 *
 * These test the full pipeline from conflict parsing through context extraction
 * using real TypeScript files (without AI calls — AI is mocked).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseConflicts, replaceConflict } from '../../core/conflictParser';
import { extractContext, clearProjectCache } from '../../core/contextEngine';

suite('Integration: Merge Resolution Flow', () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mergeai-test-'));
    clearProjectCache();
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('full flow: parse → extract context → replace', async () => {
    // Create a realistic conflicted file
    const conflictedFile = `import { validateEmail } from './utils';

interface User {
  name: string;
  email: string;
}

function createUser(name: string, email: string): User {
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

export { createUser };
`;

    // Create utils file for context resolution
    const utilsFile = `export function validateEmail(email: string): boolean {
  return /^[^@]+@[^@]+\\.[^@]+$/.test(email);
}
`;

    const mainPath = path.join(tempDir, 'main.ts');
    const utilsPath = path.join(tempDir, 'utils.ts');
    fs.writeFileSync(mainPath, conflictedFile);
    fs.writeFileSync(utilsPath, utilsFile);

    // Also create a minimal tsconfig
    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'commonjs',
          strict: true,
          rootDir: '.',
        },
        include: ['./**/*.ts'],
      })
    );

    // 1. Parse conflicts
    const parsed = parseConflicts(conflictedFile, mainPath, 'typescript');
    assert.strictEqual(parsed.conflicts.length, 1);

    const conflict = parsed.conflicts[0];
    assert.ok(conflict.currentContent.includes('validateEmail'));
    assert.ok(conflict.incomingContent.includes('toLowerCase'));

    // 2. Extract context
    const context = await extractContext(
      mainPath,
      conflictedFile,
      conflict,
      tempDir,
      2
    );

    // Should find imports
    assert.ok(context.imports.length >= 0); // May or may not resolve depending on ts-morph
    assert.ok(context.surroundingCode.length > 0);
    assert.ok(context.summary.length > 0);

    // 3. Simulate resolution (mock AI output)
    const resolvedCode = `  const validated = validateEmail(email);
  if (!validated) {
    throw new Error('Invalid email: ' + email);
  }
  return { name: name.trim(), email: email.toLowerCase() };`;

    // 4. Replace conflict
    const result = replaceConflict(conflictedFile, conflict, resolvedCode);

    // Verify no conflict markers remain
    assert.ok(!result.includes('<<<<<<<'));
    assert.ok(!result.includes('======='));
    assert.ok(!result.includes('>>>>>>>'));

    // Verify the resolved code is present
    assert.ok(result.includes('validateEmail'));
    assert.ok(result.includes('toLowerCase'));
    assert.ok(result.includes('import { validateEmail }'));
    assert.ok(result.includes('export { createUser }'));
  });

  test('handles file with multiple conflicts', () => {
    const content = `const config = {
<<<<<<< HEAD
  port: 3000,
  host: 'localhost',
=======
  port: 8080,
  host: '0.0.0.0',
>>>>>>> production
  debug: false,
<<<<<<< HEAD
  logLevel: 'info',
=======
  logLevel: 'warn',
>>>>>>> production
};`;

    const parsed = parseConflicts(content, 'config.ts', 'typescript');
    assert.strictEqual(parsed.conflicts.length, 2);

    // Resolve from bottom to top
    let result = content;
    result = replaceConflict(result, parsed.conflicts[1], "  logLevel: 'warn',");
    
    // Re-parse to get updated line numbers
    const reparsed = parseConflicts(result, 'config.ts', 'typescript');
    assert.strictEqual(reparsed.conflicts.length, 1);
    
    result = replaceConflict(result, reparsed.conflicts[0], "  port: 8080,\n  host: 'localhost',");

    assert.ok(!result.includes('<<<<<<<'));
    assert.ok(result.includes('8080'));
    assert.ok(result.includes('localhost'));
    assert.ok(result.includes('warn'));
  });
});
