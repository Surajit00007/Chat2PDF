import { parseChatRequest } from "../../src/parser";

export const handler = async (event: { httpMethod?: string; body?: string | null }) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({
        success: false,
        error: "Method not allowed. Use POST to parse chat content.",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }

  try {
    const payload = event.body ? JSON.parse(event.body) : {};
    const result = await parseChatRequest(payload);

    return {
      statusCode: result.statusCode,
      body: JSON.stringify(result.body),
      headers: {
        "Content-Type": "application/json",
      },
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error?.message || "An unexpected error occurred while parsing the chat content.",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }
};
