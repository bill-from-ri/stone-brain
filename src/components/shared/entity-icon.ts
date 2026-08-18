/**
 * A Phosphor icon per entity type.
 *
 * The prototype's entity rail gave each row an icon that said what kind of
 * thing it was — a crown for a house, a user for a character, mountains for
 * geography (lines 638-643). The port had flattened every row to the same
 * `ph-polygon`, which reads as decoration rather than information. These are
 * the same idea over this project's ten types.
 */
const ICONS: Record<string, string> = {
  character: 'ph-user',
  faction: 'ph-flag-banner',
  society: 'ph-buildings',
  culture: 'ph-users-three',
  religion: 'ph-church',
  settlement: 'ph-city',
  region: 'ph-mountains',
  artifact: 'ph-crown-simple',
  event: 'ph-lightning',
  commodity: 'ph-package',
}

export function entityIcon(entityType: string): string {
  return `ph ${ICONS[entityType] ?? 'ph-polygon'}`
}
