import { CountersDO } from '../../src/durable-objects/counters-do';

/**
 * Binds env.COUNTERS_DO to real CountersDO instances (one per id name) backed
 * by in-memory storage, so code that talks to the DO over fetch runs the real
 * handler against env.DB.
 */
export function withRealCountersDO<T extends Record<string, any>>(env: T): T {
  const instances = new Map<string, CountersDO>();
  const createState = () => {
    const map = new Map<string, unknown>();
    return {
      blockConcurrencyWhile: <R>(fn: () => Promise<R>) => fn(),
      storage: {
        get: async (key: string) => map.get(key),
        put: async (key: string, value: unknown) => {
          map.set(key, value);
        },
        list: async ({ prefix }: { prefix: string }) =>
          new Map([...map].filter(([key]) => key.startsWith(prefix))),
        delete: async (keys: string[]) => keys.filter((key) => map.delete(key)).length,
      },
    };
  };
  (env as Record<string, unknown>).COUNTERS_DO = {
    idFromName: (name: string) => ({ toString: () => name }),
    get: (id: { toString(): string }) => {
      const name = id.toString();
      let instance = instances.get(name);
      if (!instance) {
        instance = new CountersDO(createState() as any, env as any);
        instances.set(name, instance);
      }
      const target = instance;
      return {
        fetch: (url: string, init?: RequestInit) => target.fetch(new Request(url, init)),
      };
    },
  };
  return env;
}
