// Types for scripts/changelog.cjs, for its tests.
export declare const GROUPS: readonly string[]
export declare function parseEntries(text: string, source?: string): Map<string, string[]>
export declare function mergeEntries(parsed: Iterable<Map<string, string[]>>): string
