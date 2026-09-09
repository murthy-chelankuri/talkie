export function shouldRedactInputValue(inputType: string): boolean {
  return inputType.toLowerCase() === 'password'
}
