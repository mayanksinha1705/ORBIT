import { validateAction } from "../../shared/actions.js";

const MAX_TEXT = 12000;

export function requireString(value, name, maxLength = MAX_TEXT) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    const error = new Error(`${name} must be a non-empty string of at most ${maxLength} characters.`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

export function validatePlanRequest(body) {
  requireString(body?.instruction, "instruction");
  if (!body?.observation || typeof body.observation !== "object") {
    const error = new Error("observation is required.");
    error.statusCode = 400;
    throw error;
  }
  if (body.screenshot != null &&
      (typeof body.screenshot !== "string" || body.screenshot.length > 10_000_000 ||
       !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/i.test(body.screenshot))) {
    const error = new Error("screenshot must be a JPEG or PNG data URL under 10 MB.");
    error.statusCode = 400;
    throw error;
  }
  return body;
}

export function validateModelResponse(body) {
  const action = body?.action ?? body;
  const result = validateAction(action);
  if (!result.valid) {
    const error = new Error(`Reasoning model returned an invalid action: ${result.error}`);
    error.statusCode = 502;
    throw error;
  }
  if (typeof body?.reasoning_summary !== "string" || !body.reasoning_summary.trim()) {
    const error = new Error("Reasoning model returned no spoken reply.");
    error.statusCode = 502;
    throw error;
  }
  return { ...body, action };
}
