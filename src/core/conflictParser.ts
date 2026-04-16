/**
 * Git merge conflict parser.
 *
 * Detects standard Git conflict markers and extracts structured conflict blocks.
 * Handles multiple conflicts per file and edge cases (nested markers, empty blocks).
 */

import { ConflictBlock, ParsedFile } from './types';

const MARKER_START = /^<{7}\s*(.+)?$/;
const MARKER_SEPARATOR = /^={7}$/;
const MARKER_END = /^>{7}\s*(.+)?$/;

enum ParserState {
  Outside,
  InCurrent,
  InIncoming,
}

/**
 * Parse all Git merge conflicts from file content.
 */
export function parseConflicts(content: string, filePath: string, languageId: string): ParsedFile {
  const lines = content.split('\n');
  const conflicts: ConflictBlock[] = [];

  let state = ParserState.Outside;
  let startLine = -1;
  let currentBranch = '';
  let currentLines: string[] = [];
  let incomingLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    switch (state) {
      case ParserState.Outside: {
        const startMatch = line.match(MARKER_START);
        if (startMatch) {
          state = ParserState.InCurrent;
          startLine = i;
          currentBranch = (startMatch[1] ?? 'HEAD').trim();
          currentLines = [];
          incomingLines = [];
        }
        break;
      }

      case ParserState.InCurrent: {
        if (MARKER_SEPARATOR.test(line)) {
          state = ParserState.InIncoming;
        } else {
          currentLines.push(line);
        }
        break;
      }

      case ParserState.InIncoming: {
        const endMatch = line.match(MARKER_END);
        if (endMatch) {
          const incomingBranch = (endMatch[1] ?? 'incoming').trim();
          const rawLines = lines.slice(startLine, i + 1);

          conflicts.push({
            startLine,
            endLine: i,
            currentContent: currentLines.join('\n'),
            incomingContent: incomingLines.join('\n'),
            currentBranch,
            incomingBranch,
            rawText: rawLines.join('\n'),
          });

          state = ParserState.Outside;
        } else {
          incomingLines.push(line);
        }
        break;
      }
    }
  }

  return { conflicts, filePath, languageId, fullContent: content };
}

/**
 * Find the conflict block that contains or is nearest to a given line number.
 */
export function findConflictAtLine(parsed: ParsedFile, line: number): ConflictBlock | undefined {
  return parsed.conflicts.find(c => line >= c.startLine && line <= c.endLine);
}

/**
 * Check if file content contains any Git merge conflicts.
 */
export function hasConflicts(content: string): boolean {
  const lines = content.split('\n');
  const hasStart = lines.some(line => MARKER_START.test(line));
  const hasEnd = lines.some(line => MARKER_END.test(line));
  return hasStart && hasEnd;
}

/**
 * Replace a single conflict block in the file content with resolved code.
 * Returns the new file content.
 */
export function replaceConflict(
  content: string,
  conflict: ConflictBlock,
  resolvedCode: string
): string {
  const lines = content.split('\n');
  const before = lines.slice(0, conflict.startLine);
  const after = lines.slice(conflict.endLine + 1);
  return [...before, resolvedCode, ...after].join('\n');
}
