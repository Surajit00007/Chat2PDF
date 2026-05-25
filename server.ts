import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { getAiClient, parseChatRequest } from "./src/parser.js";
import dotenv from "dotenv";

dotenv.config();

export async function createApp(options: { includeStatic?: boolean } = {}) {
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  const ai = getAiClient();

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: process.env.NODE_ENV || "development" });
  });

  app.post("/api/parse-chat", async (req, res) => {
    try {
      const result = await parseChatRequest(req.body, ai);
      res.status(result.statusCode).json(result.body);
    } catch (err: any) {
      console.error("Express route /api/parse-chat error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "An exception occurred while interpreting your chat content. Please try again.",
      });
    }
  });

  if (options.includeStatic !== false) {
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  return app;
}

async function startServer() {
  const app = await createApp({ includeStatic: true });
  const PORT = Number(process.env.PORT || 3000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running on http://0.0.0.0:${PORT} under ${process.env.NODE_ENV || "development"} mode`);
  });
}

const isCliEntry = Boolean(
  process.argv[1] &&
    (process.argv[1].includes("server.ts") || process.argv[1].includes("server.cjs"))
);

if (isCliEntry) {
  startServer().catch((error) => {
    console.error("CRITICAL: Failed to launch server:", error);
  });
}
