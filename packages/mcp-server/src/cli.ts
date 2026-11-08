import { startMcp } from './index';

startMcp({
  allowSensitive: process.argv.includes('--allow-sensitive'),
});
