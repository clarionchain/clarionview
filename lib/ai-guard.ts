/**
 * Central choke point before any metered OpenRouter call.
 * Today: no-op. Later: credits, subscription tier, rate limits.
 */
export function assertCanUseAi(userId: number): void {
  void userId
}
