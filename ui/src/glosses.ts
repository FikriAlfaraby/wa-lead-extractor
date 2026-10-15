import glossData from "../../data/glosses-en.json";

/**
 * The English line for an Indonesian line the simulator shows, or null when the line is already in
 * English. The glosses are written and checked in the pipeline repo (src/glosses.ts); the models never
 * saw them, and the simulator shows the original first, with the English in grey under it.
 */
const glosses: Record<string, string | null> = glossData.glosses;

export function english(text: string | null | undefined): string | null {
  return text ? (glosses[text] ?? null) : null;
}
