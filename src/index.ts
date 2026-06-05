import { KiroConfig } from './types.js';

/**
 * Plugin entry: config + auth + provider hooks
 */
const plugin = {
  name: 'kiro',
  version: '0.1.0',
  config: {
    schema: {},
  },
  auth: {
    methods: [],
    loader: async () => {
      throw new Error('not implemented');
    },
  },
  provider: async (options: unknown) => {
    throw new Error('not implemented');
  },
};

export default plugin;
