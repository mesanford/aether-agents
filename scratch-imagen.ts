import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt: 'test prompt',
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
      }
    });
    console.log("Success:", response.generatedImages?.length);
  } catch (err: any) {
    console.error("FAILED:", err.message);
  }
}
run();
