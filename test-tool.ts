import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { generateImageTool } from './src/server/ai/tools.ts';

async function run() {
  const result = await generateImageTool.invoke({ prompt: 'test' }, { configurable: { thread_id: 'thread_123:1' } });
  console.log("RESULT:", result);
}
run();
