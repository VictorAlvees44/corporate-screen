// Mantém o campo de resposta antigo para que players já abertos também
// recebam atualizações individuais, sem mudar o ciclo das outras TVs.
export function latestPlayerRefresh(global: string, individual?: string): string {
  const globalTime = Date.parse(global)
  const individualTime = Date.parse(individual ?? '')
  return Number.isFinite(individualTime) && (!Number.isFinite(globalTime) || individualTime > globalTime)
    ? individual! : global
}
