import { updateScore, ROLE_TO_FIELD } from "./lib/notion";
import rateLimit from "./lib/rateLimit";

export default {
  async queue(batch) {
    for (const message of batch.messages) {
      const { pageId, value, role } = message.body || {};
      const field = ROLE_TO_FIELD[role] || ROLE_TO_FIELD.peer;
      try {
        await rateLimit.wait();
        await updateScore(pageId, field, value);
        console.log(`[QUEUE] Updated ${pageId} -> ${field} = ${value}`);
      } catch (error) {
        console.error(`[QUEUE] Failed to update ${pageId}:`, error);
        rateLimit.recordError?.(error);
        message.retry();
      }
    }
  }
};
