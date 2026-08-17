'use client';

import { useNativeAuthCallback } from '@/hooks/useNativeAuthCallback';

export function NativeAuthInit() {
  useNativeAuthCallback();
  return null;
}
