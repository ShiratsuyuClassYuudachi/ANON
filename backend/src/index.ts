import mongoose from 'mongoose';
import { app } from './app';
import { config } from './config';
import { initStorage } from './services/storage';

async function main() {
  await mongoose.connect(config.mongoUri);
  await initStorage();
  app.listen(config.port, () => console.log(`backend listening on :${config.port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
