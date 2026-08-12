export function resolveProductionDatabaseSwitches(
  env: NodeJS.ProcessEnv = process.env
) {
  return {
    synchronize: env.PAH_DB_SYNCHRONIZE === 'true',
    initialize: env.PAH_DB_INITIALIZE === 'true',
  };
}
