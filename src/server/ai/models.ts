import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { config } from 'dotenv';
config({ path: '.env.local', override: true });

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

// Primary model — frontier-class, used for all agent and supervisor calls
export const llm = new ChatGoogleGenerativeAI({ model: 'gemini-3-flash-preview', temperature: 0, apiKey });

// Stable fallback — used when the primary model returns 429/503 or "overloaded" errors
export const llmFallback = new ChatGoogleGenerativeAI({ model: 'gemini-2.5-flash', temperature: 0, apiKey });

// Lite model for utility tasks (context compaction / summarisation / deduplication)
export const liteLLM = new ChatGoogleGenerativeAI({ model: 'gemini-3.1-flash-lite-preview', temperature: 0, apiKey });

// Stable fallback for the lite model
export const liteLLMFallback = new ChatGoogleGenerativeAI({ model: 'gemini-2.5-flash-lite', temperature: 0, apiKey });
