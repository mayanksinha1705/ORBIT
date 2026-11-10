export const ACTION_TYPES = [
  "navigate",
  "click",
  "type",
  "scroll",
  "extract_text",
  "select_option",
  "wait",
  "go_back",
  "go_forward",
  "finish",
];

export const TASK_STATES = [
  "idle",
  "listening",
  "transcribing",
  "understanding",
  "planning",
  "reading",
  "executing",
  "verifying",
  "speaking",
  "completed",
  "failed",
  "cancelled",
];

const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

export function validateAction(value) {
  if (!value || typeof value !== "object" || !ACTION_TYPES.includes(value.type)) {
    return { valid: false, error: "Unsupported or missing action type." };
  }
  if (value.type === "navigate" && !nonEmptyString(value.url)) {
    return { valid: false, error: "navigate requires a URL." };
  }
  const hasPoint = Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y));
  if (["click", "type", "select_option"].includes(value.type) && !nonEmptyString(value.element_id) &&
      !(hasPoint && ["click", "type"].includes(value.type))) {
    return { valid: false, error: `${value.type} requires element_id or valid x/y coordinates.` };
  }
  if (value.type === "type" && (typeof value.value !== "string" || value.value.length > 4000)) {
    return { valid: false, error: "type requires a string value of at most 4000 characters." };
  }
  if (value.type === "select_option" && !nonEmptyString(value.value)) {
    return { valid: false, error: "select_option requires a value." };
  }
  if (value.type === "scroll" && value.direction !== "up" && value.direction !== "down") {
    return { valid: false, error: "scroll direction must be up or down." };
  }
  if (value.type === "wait") {
    const ms = Number(value.ms);
    if (!Number.isFinite(ms) || ms < 0 || ms > 10000) {
      return { valid: false, error: "wait ms must be between 0 and 10000." };
    }
  }
  if (value.type === "finish" && !nonEmptyString(value.summary)) {
    return { valid: false, error: "finish requires a summary." };
  }
  return { valid: true };
}
