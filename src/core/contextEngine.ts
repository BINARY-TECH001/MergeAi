/**
 * Context-aware code analysis engine.
 *
 * Uses ts-morph to analyze the file containing conflicts and extract
 * relevant imports, functions, and types referenced in the conflict region.
 * Resolves definitions up to a configurable depth to provide the AI
 * with sufficient context for intelligent merging.
 */

import { Project, SourceFile, SyntaxKind, Node, FunctionDeclaration, TypeAliasDeclaration, InterfaceDeclaration } from 'ts-morph';
import * as path from 'path';
import { CodeContext, ConflictBlock, ImportInfo, FunctionInfo, TypeInfo } from './types';

/** Cache parsed projects by workspace root to avoid re-parsing. */
const projectCache = new Map<string, { project: Project; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Get or create a ts-morph Project for the given workspace root.
 */
function getProject(workspaceRoot: string): Project {
  const cached = projectCache.get(workspaceRoot);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.project;
  }

  const tsconfigPath = path.join(workspaceRoot, 'tsconfig.json');
  let project: Project;

  try {
    project = new Project({ tsConfigFilePath: tsconfigPath });
  } catch {
    // Fallback: create project without tsconfig
    project = new Project({
      compilerOptions: {
        target: 99, // ESNext
        module: 99,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
    });
  }

  projectCache.set(workspaceRoot, { project, timestamp: Date.now() });
  return project;
}

/**
 * Clear the project cache (useful for testing or when config changes).
 */
export function clearProjectCache(): void {
  projectCache.clear();
}

/**
 * Extract code context relevant to a conflict block.
 */
export async function extractContext(
  filePath: string,
  fileContent: string,
  conflict: ConflictBlock,
  workspaceRoot: string,
  maxDepth: number = 2
): Promise<CodeContext> {
  // Strip conflict markers so ts-morph can parse
  const cleanContent = stripConflictMarkers(fileContent, conflict);

  const project = getProject(workspaceRoot);

  let sourceFile: SourceFile;
  try {
    sourceFile = project.createSourceFile(filePath, cleanContent, { overwrite: true });
  } catch {
    // If parsing fails, return minimal context
    return buildMinimalContext(fileContent, conflict);
  }

  const imports = extractImports(sourceFile);
  const conflictText = conflict.currentContent + '\n' + conflict.incomingContent;

  // Identify symbols referenced in the conflict
  const referencedSymbols = extractReferencedIdentifiers(conflictText);

  const functions = extractRelevantFunctions(sourceFile, referencedSymbols, project, maxDepth);
  const types = extractRelevantTypes(sourceFile, referencedSymbols, project, maxDepth);

  // Surrounding code: lines around the conflict (50 lines before/after)
  const surroundingCode = extractSurroundingCode(fileContent, conflict, 50);

  const summary = buildSummary(imports, functions, types);

  // Clean up the temporary source file
  try {
    project.removeSourceFile(sourceFile);
  } catch {
    // Ignore cleanup errors
  }

  return { imports, functions, types, surroundingCode, summary };
}

/**
 * Strip conflict markers from content so it can be parsed as valid code.
 * Keeps the HEAD version of each conflict for analysis.
 */
function stripConflictMarkers(content: string, _conflict: ConflictBlock): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inConflict = false;
  let pastSeparator = false;

  for (const line of lines) {
    if (/^<{7}/.test(line)) {
      inConflict = true;
      pastSeparator = false;
      continue;
    }
    if (inConflict && /^={7}$/.test(line)) {
      pastSeparator = true;
      continue;
    }
    if (inConflict && /^>{7}/.test(line)) {
      inConflict = false;
      pastSeparator = false;
      continue;
    }
    if (inConflict && pastSeparator) {
      // Skip incoming content
      continue;
    }
    result.push(line);
  }

  return result.join('\n');
}

/**
 * Extract all import declarations from a source file.
 */
function extractImports(sourceFile: SourceFile): ImportInfo[] {
  return sourceFile.getImportDeclarations().map(imp => {
    const namedImports = imp.getNamedImports().map(n => n.getName());
    const defaultImport = imp.getDefaultImport()?.getText();
    const isTypeOnly = imp.isTypeOnly();
    const moduleSpecifier = imp.getModuleSpecifierValue();

    return { moduleSpecifier, namedImports, defaultImport, isTypeOnly };
  });
}

/**
 * Extract identifiers from conflict text using a simple regex approach.
 * This catches function calls, variable refs, type refs, etc.
 */
function extractReferencedIdentifiers(text: string): Set<string> {
  const identifiers = new Set<string>();
  // Match word-boundary identifiers, exclude JS keywords
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
    if (!keywords.has(m[1])) {
      identifiers.add(m[1]);
    }
  }

  return identifiers;
}

/**
 * Find function declarations that match referenced symbols.
 * Optionally resolves into imported modules up to maxDepth.
 */
function extractRelevantFunctions(
  sourceFile: SourceFile,
  symbols: Set<string>,
  project: Project,
  maxDepth: number,
  currentDepth: number = 0,
  visited: Set<string> = new Set()
): FunctionInfo[] {
  const results: FunctionInfo[] = [];
  if (currentDepth > maxDepth) return results;

  // Functions in current file
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name && symbols.has(name) && !visited.has(name)) {
      visited.add(name);
      results.push({
        name,
        signature: fn.getSignature()?.getDeclaration().getText() ?? fn.getText().split('{')[0].trim(),
        body: fn.getText(),
        filePath: sourceFile.getFilePath(),
      });
    }
  }

  // Arrow functions / const declarations
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const name = varDecl.getName();
    if (symbols.has(name) && !visited.has(name)) {
      const init = varDecl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        visited.add(name);
        results.push({
          name,
          signature: varDecl.getText().split('=>')[0].trim(),
          body: varDecl.getText(),
          filePath: sourceFile.getFilePath(),
        });
      }
    }
  }

  // Class methods
  for (const cls of sourceFile.getClasses()) {
    for (const method of cls.getMethods()) {
      const name = method.getName();
      if (symbols.has(name) && !visited.has(name)) {
        visited.add(name);
        results.push({
          name,
          signature: method.getText().split('{')[0].trim(),
          body: method.getText(),
          filePath: sourceFile.getFilePath(),
        });
      }
    }
  }

  // Resolve into imported modules
  if (currentDepth < maxDepth) {
    for (const imp of sourceFile.getImportDeclarations()) {
      const modFile = imp.getModuleSpecifierSourceFile();
      if (modFile) {
        const importedNames = new Set(imp.getNamedImports().map(n => n.getName()));
        const overlap = [...symbols].filter(s => importedNames.has(s));
        if (overlap.length > 0) {
          const deeper = extractRelevantFunctions(
            modFile,
            new Set(overlap),
            project,
            maxDepth,
            currentDepth + 1,
            visited
          );
          results.push(...deeper);
        }
      }
    }
  }

  return results;
}

/**
 * Find type/interface declarations that match referenced symbols.
 */
function extractRelevantTypes(
  sourceFile: SourceFile,
  symbols: Set<string>,
  project: Project,
  maxDepth: number,
  currentDepth: number = 0,
  visited: Set<string> = new Set()
): TypeInfo[] {
  const results: TypeInfo[] = [];
  if (currentDepth > maxDepth) return results;

  // Interfaces
  for (const iface of sourceFile.getInterfaces()) {
    const name = iface.getName();
    if (symbols.has(name) && !visited.has(name)) {
      visited.add(name);
      results.push({
        name,
        definition: iface.getText(),
        filePath: sourceFile.getFilePath(),
      });
    }
  }

  // Type aliases
  for (const ta of sourceFile.getTypeAliases()) {
    const name = ta.getName();
    if (symbols.has(name) && !visited.has(name)) {
      visited.add(name);
      results.push({
        name,
        definition: ta.getText(),
        filePath: sourceFile.getFilePath(),
      });
    }
  }

  // Enums
  for (const en of sourceFile.getEnums()) {
    const name = en.getName();
    if (symbols.has(name) && !visited.has(name)) {
      visited.add(name);
      results.push({
        name,
        definition: en.getText(),
        filePath: sourceFile.getFilePath(),
      });
    }
  }

  // Resolve into imports
  if (currentDepth < maxDepth) {
    for (const imp of sourceFile.getImportDeclarations()) {
      const modFile = imp.getModuleSpecifierSourceFile();
      if (modFile) {
        const importedNames = new Set(imp.getNamedImports().map(n => n.getName()));
        const overlap = [...symbols].filter(s => importedNames.has(s));
        if (overlap.length > 0) {
          const deeper = extractRelevantTypes(
            modFile,
            new Set(overlap),
            project,
            maxDepth,
            currentDepth + 1,
            visited
          );
          results.push(...deeper);
        }
      }
    }
  }

  return results;
}

/**
 * Extract lines surrounding the conflict for broader context.
 */
function extractSurroundingCode(content: string, conflict: ConflictBlock, radius: number): string {
  const lines = content.split('\n');
  const start = Math.max(0, conflict.startLine - radius);
  const end = Math.min(lines.length, conflict.endLine + radius + 1);
  return lines.slice(start, end).join('\n');
}

/**
 * Build a human-readable summary of extracted context.
 */
function buildSummary(imports: ImportInfo[], functions: FunctionInfo[], types: TypeInfo[]): string {
  const parts: string[] = [];
  if (imports.length > 0) parts.push(`${imports.length} import(s)`);
  if (functions.length > 0) parts.push(`${functions.length} function(s)`);
  if (types.length > 0) parts.push(`${types.length} type(s)/interface(s)`);
  return parts.length > 0 ? `Context: ${parts.join(', ')}` : 'Minimal context available';
}

/**
 * Build minimal context when ts-morph parsing fails.
 */
function buildMinimalContext(fileContent: string, conflict: ConflictBlock): CodeContext {
  const surroundingCode = extractSurroundingCode(fileContent, conflict, 30);
  return {
    imports: [],
    functions: [],
    types: [],
    surroundingCode,
    summary: 'Minimal context (parsing failed)',
  };
}
