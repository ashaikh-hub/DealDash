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
  const t = createTranslator(locale);

  useEffect(() => {
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

  if (!installEvent) return null;
  return (
    <div style={{ padding: 12 }}>
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
    </div>
  );
}
