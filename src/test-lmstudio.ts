import "dotenv/config";
import { LMStudioProvider } from "./providers/lmstudio";
import { MODELS } from "./config/models";

async function run() {
  const provider = new LMStudioProvider();

  const result = await provider.chat({
    model: MODELS.ministral,
    messages: [
      {
        role: "user",
        content: "Write a hello world function in TypeScript"
      }
    ]
  });

  console.log(result.content);
}

run();

