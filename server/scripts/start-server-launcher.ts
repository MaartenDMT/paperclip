import { logger } from "../src/middleware/logger.js";
import { startServer } from "../src/index.js";

void startServer().catch((err) => {
  logger.error({ err }, "Paperclip server failed to start");
  process.exit(1);
});
