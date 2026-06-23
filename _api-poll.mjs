import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
for (let i = 1; i <= 30; i++) {
  try {
    await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 10, messages: [{ role: "user", content: "ok" }] });
    console.log(`RECOVERED on attempt ${i} — Anthropic API is responding again`);
    process.exit(0);
  } catch (e) {
    console.log(`attempt ${i}: still down (${e.status})`);
    await sleep(60);
  }
}
console.log("STILL_DOWN after 30 minutes");
process.exit(1);
