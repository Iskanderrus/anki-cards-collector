export function reconcileReviewSessionMerge(
  ids: string[],
  sourceId: string,
  targetId: string,
  survivingId: string,
): string[] {
  const involved = new Set([sourceId, targetId, survivingId]);
  const sourceIndex = ids.indexOf(sourceId);
  const fallbackIndex = ids.findIndex((id) => involved.has(id));
  const anchorIndex = sourceIndex >= 0 ? sourceIndex : fallbackIndex;

  if (anchorIndex < 0) return ids;

  // The action is initiated from sourceId, so sourceId is the logical current
  // review position when it exists in the snapshot. Remove any earlier/later
  // copy of the target/survivor and insert the survivor at that logical current
  // position. This preserves the already-reviewed prefix and the unreviewed
  // suffix instead of rewinding to an earlier survivor.
  const before = ids
    .slice(0, anchorIndex)
    .filter((id) => !involved.has(id));
  const after = ids
    .slice(anchorIndex + 1)
    .filter((id) => !involved.has(id));

  return [...before, survivingId, ...after];
}
