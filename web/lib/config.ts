// Load config from environment variables or defaults
export const config = {
  evmRpcUrl: typeof window !== 'undefined' ? null : process.env.EVM_RPC_URL || '',
  sparkOwner: typeof window !== 'undefined' ? null : process.env.SPARK_OWNER || '',
};

// Client-side config helper
export function getConfig() {
  if (typeof window === 'undefined') return config;
  // On client, config would come from API or be inlined at build time
  return { evmRpcUrl: '', sparkOwner: '' };
}
