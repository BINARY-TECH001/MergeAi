/**
 * Core type definitions for MergeAI.
 */

export type MergeStrategy = 'preserve-all' | 'prefer-current' | 'prefer-incoming' | 'custom';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface ConflictBlock {
  /** 0-indexed line number where <<<<<<< starts */
  startLine: number;
  /** 0-indexed line number where >>>>>>> ends */
  endLine: number;
  /** Content between <<<<<<< and ======= */
  currentContent: string;
  /** Content between ======= and >>>>>>> */
  incomingContent: string;
  /** Branch name from <<<<<<< marker (e.g. HEAD) */
  currentBranch: string;
  /** Branch name from >>>>>>> marker */
  incomingBranch: string;
  /** Raw text of entire conflict block including markers */
  rawText: string;
}

export interface ParsedFile {
  conflicts: ConflictBlock[];
  filePath: string;
  languageId: string;
  fullContent: string;
}

export interface CodeContext {
  /** Imports used in the conflicting region */
  imports: ImportInfo[];
  /** Functions referenced or defined near the conflict */
  functions: FunctionInfo[];
  /** Types/interfaces referenced in the conflict */
  types: TypeInfo[];
  /** Surrounding code (non-conflict) for context */
  surroundingCode: string;
  /** Summary for display */
  summary: string;
}

export interface ImportInfo {
  moduleSpecifier: string;
  namedImports: string[];
  defaultImport?: string;
  isTypeOnly: boolean;
}

export interface FunctionInfo {
  name: string;
  signature: string;
  body: string;
  filePath: string;
}

export interface TypeInfo {
  name: string;
  definition: string;
  filePath: string;
}

export interface MergeRequest {
  conflict: ConflictBlock;
  strategy: MergeStrategy;
  customInstruction?: string;
  context: CodeContext;
  fileContent: string;
  filePath: string;
  languageId: string;
}

export interface MergeResult {
  resolvedCode: string;
  reasoning: string;
  confidence: ConfidenceLevel;
  strategy: MergeStrategy;
}

export interface ValidationResult {
  success: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  message: string;
  line?: number;
  column?: number;
  source: 'typescript' | 'eslint' | 'test';
}

export interface ValidationWarning {
  message: string;
  source: 'typescript' | 'eslint';
}

export interface AIProviderConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'custom';
  apiKey: string;
  model: string;
  endpoint?: string;
}
