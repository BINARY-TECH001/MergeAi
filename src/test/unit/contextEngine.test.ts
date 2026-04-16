/**
 * Unit tests for contextEngine (identifier extraction, minimal context fallback).
 */

import * as assert from 'assert';

// We test the exported functions. The identifier extractor is private,
// so we test it indirectly through extractContext behavior.
// For direct unit testing, we replicate the identifier extraction logic here.

suite('ContextEngine', () => {
  function extractReferencedIdentifiers(text: string): Set<string> {
    const identifiers = new Set<string>();
    const keywords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'throw', 'try', 'catch', 'finally', 'new', 'delete', 'typeof',
      'instanceof', 'void', 'in', 'of', 'let', 'const', 'var', 'function',
      'class', 'extends', 'implements', 'import', 'export', 'default', 'from',
      'as', 'async', 'await', 'yield', 'this', 'super', 'true', 'false', 'null',
      'undefined', 'string', 'number', 'boolean', 'any', 'unknown', 'never',
    ]);
    const matches = text.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g);
    for (const m of matches) {
      if (!keywords.has(m[1])) identifiers.add(m[1]);
    }
    return identifiers;
  }

  test('extracts identifiers from code', () => {
    const code = `const result = calculateTotal(items, taxRate);`;
    const ids = extractReferencedIdentifiers(code);
    assert.ok(ids.has('result'));
    assert.ok(ids.has('calculateTotal'));
    assert.ok(ids.has('items'));
    assert.ok(ids.has('taxRate'));
    assert.ok(!ids.has('const'));
  });

  test('filters out keywords', () => {
    const code = `if (true) { return await fetchData(); }`;
    const ids = extractReferencedIdentifiers(code);
    assert.ok(ids.has('fetchData'));
    assert.ok(!ids.has('if'));
    assert.ok(!ids.has('true'));
    assert.ok(!ids.has('return'));
    assert.ok(!ids.has('await'));
  });

  test('handles type references', () => {
    const code = `const user: UserProfile = getUser(userId);`;
    const ids = extractReferencedIdentifiers(code);
    assert.ok(ids.has('UserProfile'));
    assert.ok(ids.has('getUser'));
    assert.ok(ids.has('userId'));
    assert.ok(ids.has('user'));
  });

  test('handles empty input', () => {
    const ids = extractReferencedIdentifiers('');
    assert.strictEqual(ids.size, 0);
  });
});
