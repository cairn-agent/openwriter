/** Author's Voice's logger, as its copied modules expect it: warnings and errors only. */
const logger = {
  info: (..._args: unknown[]): void => {},
  warn: (...args: unknown[]): void => console.warn("[Author's Voice]", ...args),
  error: (...args: unknown[]): void => console.error("[Author's Voice]", ...args),
};

export default logger;
