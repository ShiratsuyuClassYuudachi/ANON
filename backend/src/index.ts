import mongoose from 'mongoose';
import { app } from './app';
import { config } from './config';

async function main() {
  await mongoose.connect(config.mongoUri);
  app.listen(config.port, () => console.log(`backend listening on :${config.port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
