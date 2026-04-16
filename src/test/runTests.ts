/**
 * Test runner for VS Code extension tests.
 */

import * as path from 'path';
import Mocha from 'mocha';
import glob = require('glob');

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 30_000,
  });

  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((resolve, reject) => {
    // Find all test files
    const pattern = '**/*.test.js';
    const files = glob.sync(pattern, { cwd: testsRoot });

    files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
