export type WtErrorCode =
  | "USAGE_ERROR" | "CONFIG_ERROR" | "GIT_ERROR" | "SETUP_ERROR"
  | "TEARDOWN_ERROR" | "UPDATE_ERROR" | "INSTALLER_VALIDATION_ERROR";

export class WtError extends Error {
  readonly code: WtErrorCode;
  constructor(code: WtErrorCode, message: string, options?: ErrorOptions) {
    super(sanitizeMessage(message), options);
    this.name = "WtError";
    this.code = code;
  }
}
function sanitizeMessage(message: string): string {
  return message.replace(/[\r\n\0]/g, " ").replace(/\s+/g, " ").trim();
}
export class UsageError extends WtError { constructor(message: string) { super("USAGE_ERROR", message); } }
export class ConfigurationError extends WtError { constructor(message: string) { super("CONFIG_ERROR", message); } }
export class GitError extends WtError { constructor(message: string) { super("GIT_ERROR", message); } }
export class SetupError extends WtError { constructor(message: string) { super("SETUP_ERROR", message); } }
export class TeardownError extends WtError { constructor(message: string) { super("TEARDOWN_ERROR", message); } }
export class UpdateError extends WtError { constructor(message: string) { super("UPDATE_ERROR", message); } }
export class InstallerValidationError extends WtError { constructor(message: string) { super("INSTALLER_VALIDATION_ERROR", message); } }
export const ConfigError = ConfigurationError;
export const InstallerError = InstallerValidationError;
