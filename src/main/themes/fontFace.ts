/** Names for a font's face. No Node here: the theme editor in the window names faces too. */

/** "Bold Italic", from the numbers, for files whose own face name is missing or unhelpful. */
export function describeFace(weight: number, italic: boolean): string {
  const names: Record<number, string> = {
    100: 'Thin',
    200: 'Extra Light',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'Semibold',
    700: 'Bold',
    800: 'Extra Bold',
    900: 'Black'
  }
  const weightName = names[weight] ?? String(weight)
  if (!italic) return weightName
  return weight === 400 ? 'Italic' : `${weightName} Italic`
}
