export function shouldSetupPush({ isNative, enabled }: { isNative: boolean; enabled: boolean }): boolean {
  return isNative && enabled;
}
