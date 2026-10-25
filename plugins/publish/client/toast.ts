/**
 * The app's toast, reached through the client plugin API (index.tsx sets it at activation).
 */
import type { ClientPluginApi } from '@openwriter-src/plugins/client-plugins';

type ShowToast = ClientPluginApi['showToast'];
let impl: ShowToast | null = null;

export function setToast(fn: ShowToast): void {
  impl = fn;
}

export const showToast: ShowToast = (...args) => impl?.(...args);
