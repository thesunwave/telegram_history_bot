import { Env } from './env';

export class Logger {
  private static isDebugEnabled(env: Env): boolean {
    return env.DEBUG_LOGS === 'true' || env.DEBUG_LOGS === '1';
  }

  static debug(env: Env, message: string, data?: any): void {
    if (this.isDebugEnabled(env)) {
      if (data) {
        console.debug(message, data);
      } else {
        console.debug(message);
      }
    }
  }

  static log(message: string, data?: any): void {
    if (data) {
      console.log(message, data);
    } else {
      console.log(message);
    }
  }

  static error(message: string, data?: any): void {
    if (data) {
      console.error(message, data);
    } else {
      console.error(message);
    }
  }
}