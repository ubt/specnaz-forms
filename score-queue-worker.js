import { updateScore } from "./lib/notion";

const RATE_LIMIT_MS = 200;

export default {
  async queue(batch, env, ctx) {
    for (const message of batch.messages) {
      const { pageId, field, value } = message.body || {};
      try {
        await updateScore(pageId, field, value);
        console.log(`[QUEUE] Updated ${pageId} -> ${field}=${value}`);
        message.ack();
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      } catch (err) {
        console.error(`[QUEUE] Error processing ${pageId}:`, err);
        if (message.attempts && message.attempts > 3) {
          console.error(`[QUEUE] Dropping message after ${message.attempts} attempts`);
          message.ack();
        } else {
          message.retry();
        }
      }
    }
  }
};
