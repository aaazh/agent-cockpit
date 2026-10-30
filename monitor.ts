import config from './src/config';
import { createCockpitHttpApp } from './src/services/httpApp';
import { mountMonitorOnlyRoutes, startMonitorServer } from './src/services/monitorServer';

// This entry cannot be used to enable native execution, even by misconfiguration.
if (!config.MONITOR_ONLY) throw new Error('The monitoring entry requires MONITOR_ONLY=true');
const { app } = createCockpitHttpApp(config, __dirname);
mountMonitorOnlyRoutes(app);
startMonitorServer(app, config);
