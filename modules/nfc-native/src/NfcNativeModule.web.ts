import { NativeModule, registerWebModule } from 'expo';

/**
 * Web has no NFC in any form this project cares about.
 *
 * The stub exists so Metro can resolve the module when bundling for web —
 * `expo export --platform all` includes web in this project's checks — and it
 * answers honestly rather than throwing on import.
 */
class NfcNativeModule extends NativeModule<Record<never, never>> {
  isSupported(): boolean {
    return false;
  }

  isEnabled(): boolean {
    return false;
  }

  canOpenSettings(): boolean {
    return false;
  }

  async openNfcSettings(): Promise<void> {
    throw new Error('NFC is not available on the web.');
  }

  async readTag(): Promise<never> {
    throw new Error('NFC is not available on the web.');
  }

  async writeTag(): Promise<never> {
    throw new Error('NFC is not available on the web.');
  }

  async cancelScan(): Promise<void> {
    // Nothing to cancel; there was never a scan.
  }
}

export default registerWebModule(NfcNativeModule, 'NfcNativeModule');
