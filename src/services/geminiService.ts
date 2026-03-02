import { GoogleGenAI } from "@google/genai";
import { AgentRole } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function getAgentResponse(role: AgentRole, message: string, context: string = "", canGenerateImage: boolean = false) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [{ text: `You are an AI agent with the role of ${role}. 
          Your current context and mission: ${context}.
          
          CAPABILITY: You can schedule recurring tasks for yourself or others. 
          To schedule a task, include a JSON block in your response like this:
          \`\`\`json
          {
            "title": "Task Title",
            "description": "Detailed description",
            "assigneeId": "agent-id",
            "dueDate": "Date/Time",
            "repeat": "Recurrence (optional)"
          }
          \`\`\`
          ${canGenerateImage ? `
          CAPABILITY: You can generate images. If you want to generate an image to accompany your response, include a JSON block like this:
          \`\`\`json
          {
            "imagePrompt": "A detailed description of the image to generate"
          }
          \`\`\`
          ` : ''}
          Available agent IDs: executive-assistant, social-media-manager, blog-writer, sales-associate, legal-associate, receptionist.
          
          Respond to the following message as this agent: ${message}` }]
        }
      ],
      config: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 1024,
      }
    });

    const text = response.text || "I'm sorry, I couldn't process that request.";
    let imageUrl: string | undefined = undefined;

    if (canGenerateImage) {
      const imageMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*?\}/);
      if (imageMatch) {
        try {
          const data = JSON.parse(imageMatch[1] || imageMatch[0]);
          if (data.imagePrompt) {
            const imageResponse = await ai.models.generateContent({
              model: 'gemini-2.5-flash-image',
              contents: [{ parts: [{ text: data.imagePrompt }] }],
            });
            
            for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
              if (part.inlineData) {
                imageUrl = `data:image/png;base64,${part.inlineData.data}`;
                break;
              }
            }
          }
        } catch (e) {
          // Not a valid image prompt JSON or failed to generate
        }
      }
    }

    return { text, imageUrl };
  } catch (error) {
    console.error("Gemini API Error:", error);
    return { text: "Error: Failed to connect to my neural network." };
  }
}

export async function orchestrateTask(taskDescription: string, agents: string[]) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [{ text: `You are the Orchestrator AI. Your job is to break down the following task into sub-tasks for these specialized agents: ${agents.join(", ")}.
          Task: ${taskDescription}
          
          Provide a JSON response with the following structure:
          {
            "plan": [
              { "agentId": "agent-id", "action": "what they should do", "priority": "high|medium|low" }
            ]
          }` }]
        }
      ],
      config: {
        responseMimeType: "application/json",
      }
    });

    return JSON.parse(response.text || '{"plan": []}');
  } catch (error) {
    console.error("Orchestration Error:", error);
    return { plan: [] };
  }
}

export function parseTaskFromResponse(text: string) {
  // Simple regex to find a JSON block that looks like a task
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      if (data.title && data.assigneeId) {
        return {
          title: data.title,
          description: data.description || "",
          assigneeId: data.assigneeId,
          dueDate: data.dueDate || "Tomorrow",
          repeat: data.repeat
        };
      }
    } catch (e) {
      // Not a valid task JSON
    }
  }
  return null;
}
