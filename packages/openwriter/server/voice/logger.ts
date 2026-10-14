/** The voice code's logger, as its copied modules expect it: warnings and errors only. */
const logger = {
  info: (..._args: unknown[]): void => {},
  warn: (...args: unknown[]): void => console.warn("[voice]", ...args),
  error: (...args: unknown[]): void => console.error("[voice]", ...args),
};

export default logger;
