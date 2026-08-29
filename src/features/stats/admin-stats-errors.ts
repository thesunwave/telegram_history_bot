export class HistoricalStatsNotReady extends Error {
  constructor() { super('Historical statistics are not ready.'); this.name = 'HistoricalStatsNotReady'; }
}

export class AdminUnavailable extends Error {
  constructor() { super('Admin service is temporarily unavailable.'); this.name = 'AdminUnavailable'; }
}
