import worker from '../src/index';

export const testWorker = {
  fetch: worker.fetch,
  scheduled: worker.scheduled,
};