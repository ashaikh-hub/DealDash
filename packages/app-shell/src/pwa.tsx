import { useEffect, useState } from 'react';
import { createTranslator } from '@dealdash/localization';
import type { Locale } from '@dealdash/types';
import { Button } from '@dealdash/ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * PWA helpers for the Customer and Staff apps: registers the service worker (static shell only: API calls are
 * never cached, and nothing here enables offline redemption) and offers installation where supported.
 */
export function PwaRegister({ locale }: { locale: Locale }) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const t = createTranslator(locale);

  useEffect(() => {
    setDismissed(wasDismissed());
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!installEvent || dismissed) return null;
  // a quiet, dismissible strip: installation is offered, never pushed ahead of the content
  return (
    <div className="dd-install" role="region" aria-label={t('shell.installApp')}>
      <span className="dd-install__mark" aria-hidden="true">
        D
      </span>
      <span className="dd-install__text">{t('shell.installBody')}</span>
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          await installEvent.prompt();
          setInstallEvent(null);
        }}
      >
        {t('shell.installApp')}
      </Button>
      <button
        type="button"
        className="dd-install__close"
        aria-label={t('shell.installDismiss')}
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(DISMISS_KEY, String(Date.now()));
          } catch {
            /* storage unavailable: dismissed for this visit only */
          }
        }}
      >
        ×
      </button>
    </div>
  );
}

const DISMISS_KEY = 'dd.install.dismissedAt';
const DISMISS_MS = 14 * 24 * 3_600_000;
function wasDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}
