// config/sentimentPrompt.js
const DEFAULT_SENTIMENT_PROMPT = `You are a strict triage. Analyze the overall tone of the following conversation between a customer and the company.
Output exactly one token from this set: "positive", "negative", "neutral".
Use negative when the customer expresses dissatisfaction, frustration, or unfavorable feedback. If the customer is complaining, requesting refunds, or expressing anger, it's a negative message. If the customer swears it's a negative message.
Use positive when the customer shows satisfaction, happiness, or favorable feedback. "Confirmed" messages to reminders are also positive messages indicators. If the person booked an appointment at any moment during the interaction, it's a positive message. If asking questions about the service, it's a positive message.
Use "neutral" for sarcasm, ambiguous intent, or mixed signals. No explanations.`;

module.exports = { DEFAULT_SENTIMENT_PROMPT };
