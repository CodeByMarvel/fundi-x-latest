/**
 * Google's "Sign in with Google" button (Google Identity Services). Google
 * shows the account picker and hands back a signed credential; the server
 * checks it. This page never learns a password.
 */

type CredentialResponse = { credential: string };

type GoogleIdentity = {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        ux_mode?: 'popup';
      }): void;
      renderButton(
        parent: HTMLElement,
        options: { theme?: string; size?: string; text?: string; width?: number },
      ): void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let loading: Promise<GoogleIdentity> | null = null;

/** Loads Google's script once. */
export function loadGoogle(): Promise<GoogleIdentity> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () =>
      window.google ? resolve(window.google) : reject(new Error('No google'));
    script.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load Google sign-in"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
