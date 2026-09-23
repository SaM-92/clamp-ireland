export function trafficCollectionAllowed(config: {
  enabled: boolean;
  nodeEnv: string | undefined;
  databaseConfigured: boolean;
  vercelEnv: string | undefined;
}) {
  return config.enabled && config.nodeEnv === "production" &&
    config.databaseConfigured &&
    (config.vercelEnv === undefined || config.vercelEnv === "production");
}
