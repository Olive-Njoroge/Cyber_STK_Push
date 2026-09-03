import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10000 });
  console.log(`[db] connected to ${mongoose.connection.name}`);

  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));
  mongoose.connection.on('error', (err) => console.error('[db] error:', err.message));
}
