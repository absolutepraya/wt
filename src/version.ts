declare const WT_BUILD_VERSION: string | undefined;

export const VERSION =
  typeof WT_BUILD_VERSION === "string" ? WT_BUILD_VERSION : "0.0.0-dev";
