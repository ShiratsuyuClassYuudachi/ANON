import mongoose from 'mongoose';
import { app } from './app';
import { config } from './config';
import { grantPermissionToAllRoles } from './services/permissions';
import { initStorage } from './services/storage';
import { startTrialSweeper } from './services/trial';

async function main() {
  await mongoose.connect(config.mongoUri);
  await initStorage();
  await grantPermissionToAllRoles('lostfound:manage');
  startTrialSweeper();
  app.listen(config.port, () => console.log(`backend listening on :${config.port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
