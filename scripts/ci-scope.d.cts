// Types for scripts/ci-scope.cjs, for its tests.
export declare const WORDS: RegExp
export declare function withoutVersion(json: string): string
export declare function appUnchanged(
  files: string[],
  read: (file: string) => { before: string | null; after: string | null }
): { unchanged: boolean; reason: string }
