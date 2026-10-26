/** Public package names are metadata, not proof of account grants or qualifications. */
export function extractApiPermissionGroups(applyScopes: unknown): string[] {
  if (!Array.isArray(applyScopes)) return [];

  const names = applyScopes.flatMap((scope: unknown) => {
    if (
      typeof scope !== 'object' ||
      scope === null ||
      Array.isArray(scope) ||
      !('name' in scope) ||
      typeof scope.name !== 'string'
    ) {
      return [];
    }
    const name = scope.name.trim();
    return name ? [name] : [];
  });

  // No names means unknown metadata, never "no permission required".
  return [...new Set(names)];
}
