export function trafficCollectionAllowed(config: {
  enabled: boolean;
  nodeEnv: string | undefined;
  supabaseConfigured: boolean;
  serviceRoleConfigured: boolean;
  vercelEnv: string | undefined;
}) {
  return config.enabled && config.nodeEnv === "production" &&
    config.supabaseConfigured && config.serviceRoleConfigured &&
    (config.vercelEnv === undefined || config.vercelEnv === "production");
}
