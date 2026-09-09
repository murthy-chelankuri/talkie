export interface TTSProvider {
  synthesize: (text: string, outputPath: string) => Promise<void>
}
