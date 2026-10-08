/** Waits `ms` milliseconds. Used to make mock calls feel like network calls. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
