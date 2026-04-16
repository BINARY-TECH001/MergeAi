/**
 * Unit tests for conflictParser.
 */

import * as assert from 'assert';
import { parseConflicts, findConflictAtLine, hasConflicts, replaceConflict } from '../../core/conflictParser';

suite('ConflictParser', () => {
  const singleConflictFile = `import { foo } from './foo';

function main() {
<<<<<<< HEAD
  const result = foo(1, 2);
  console.log('current version');
=======
  const result = foo(1, 2, 3);
  console.log('incoming version');
>>>>>>> feature/new-api
  return result;
}`;

  const multiConflictFile = `<<<<<<< HEAD
const a = 1;
=======
const a = 2;
>>>>>>> branch-a

some code between

<<<<<<< HEAD
function old() {}
=======
function updated() {}
>>>>>>> branch-b`;

  test('parses single conflict', () => {
    const parsed = parseConflicts(singleConflictFile, 'test.ts', 'typescript');
    assert.strictEqual(parsed.conflicts.length, 1);

    const c = parsed.conflicts[0];
    assert.strictEqual(c.currentBranch, 'HEAD');
    assert.strictEqual(c.incomingBranch, 'feature/new-api');
    assert.ok(c.currentContent.includes("foo(1, 2)"));
    assert.ok(c.incomingContent.includes("foo(1, 2, 3)"));
    assert.strictEqual(c.startLine, 3);
  });

  test('parses multiple conflicts', () => {
    const parsed = parseConflicts(multiConflictFile, 'test.ts', 'typescript');
    assert.strictEqual(parsed.conflicts.length, 2);
    assert.strictEqual(parsed.conflicts[0].incomingBranch, 'branch-a');
    assert.strictEqual(parsed.conflicts[1].incomingBranch, 'branch-b');
  });

  test('findConflictAtLine returns correct conflict', () => {
    const parsed = parseConflicts(singleConflictFile, 'test.ts', 'typescript');
    const found = findConflictAtLine(parsed, 4); // inside conflict
    assert.ok(found);
    assert.strictEqual(found.currentBranch, 'HEAD');
  });

  test('findConflictAtLine returns undefined outside conflict', () => {
    const parsed = parseConflicts(singleConflictFile, 'test.ts', 'typescript');
    const found = findConflictAtLine(parsed, 0); // import line
    assert.strictEqual(found, undefined);
  });

  test('hasConflicts returns true for conflicted file', () => {
    assert.strictEqual(hasConflicts(singleConflictFile), true);
  });

  test('hasConflicts returns false for clean file', () => {
    assert.strictEqual(hasConflicts('const x = 1;'), false);
  });

  test('replaceConflict replaces correctly', () => {
    const parsed = parseConflicts(singleConflictFile, 'test.ts', 'typescript');
    const conflict = parsed.conflicts[0];
    const result = replaceConflict(singleConflictFile, conflict, '  const result = foo(1, 2, 3);\n  console.log("merged");');
    assert.ok(!result.includes('<<<<<<<'));
    assert.ok(!result.includes('>>>>>>>'));
    assert.ok(result.includes('merged'));
    assert.ok(result.includes("import { foo }"));
  });

  test('handles empty current content', () => {
    const content = `<<<<<<< HEAD
=======
const x = 1;
>>>>>>> branch`;
    const parsed = parseConflicts(content, 'test.ts', 'typescript');
    assert.strictEqual(parsed.conflicts.length, 1);
    assert.strictEqual(parsed.conflicts[0].currentContent, '');
    assert.strictEqual(parsed.conflicts[0].incomingContent, 'const x = 1;');
  });

  test('handles empty incoming content', () => {
    const content = `<<<<<<< HEAD
const x = 1;
=======
>>>>>>> branch`;
    const parsed = parseConflicts(content, 'test.ts', 'typescript');
    assert.strictEqual(parsed.conflicts.length, 1);
    assert.strictEqual(parsed.conflicts[0].currentContent, 'const x = 1;');
    assert.strictEqual(parsed.conflicts[0].incomingContent, '');
  });
});
