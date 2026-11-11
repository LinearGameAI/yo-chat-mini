// Log metadata only: never pass credentials, SDK responses, or chat content.
export function flowLog(stage: string, details: Record<string, unknown> = {}) {
  console.info(`[mini-flow] ${stage}`, { time: new Date().toISOString(), ...details });
}
export function flowError(stage: string, error: unknown, details: Record<string, unknown> = {}) {
  console.error(`[mini-flow] ${stage}`, { time: new Date().toISOString(), ...details,
    name: error instanceof Error ? error.name : typeof error,
    status: error instanceof Error && 'status' in error ? error.status : undefined });
}
