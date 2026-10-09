'use client';

import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@dealdash/app-shell';
import { createTranslator, type Locale } from '@dealdash/localization';
import { Button } from '@dealdash/ui';

type Camera = 'starting' | 'active' | 'denied' | 'unavailable';

interface Detector {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}

/**
 * Camera QR scanner. Uses the browser's BarcodeDetector where it exists (Chrome/Edge on Android) and falls back to jsQR
 * on downscaled video frames everywhere else. The camera stays on the device: only the decoded text leaves this component.
 * If the camera is refused or missing, the caller shows the manual-code fallback: scanning is never the only way in.
 */
export function CameraScanner({
  locale,
  paused,
  onCode,
  onStatus,
}: {
  locale: Locale;
  paused: boolean;
  onCode: (text: string) => void;
  onStatus?: (s: Camera) => void;
}) {
  const t = createTranslator(locale);
  const video = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<Camera>('starting');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const last = useRef<{ text: string; at: number } | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let wakeLock: { release: () => Promise<void> } | null = null;

    // Progressive enhancement: keep the screen awake while scanning where the browser allows it. Never blocks scanning.
    const holdScreen = async () => {
      try {
        const wl = (
          navigator as unknown as {
            wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
          }
        ).wakeLock;
        if (wl && !stopped && document.visibilityState === 'visible')
          wakeLock = await wl.request('screen');
      } catch {
        /* unsupported, battery saver, or not allowed: scanning still works */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void holdScreen();
    };

    const emit = (text: string) => {
      const now = Date.now();
      if (last.current && last.current.text === text && now - last.current.at < 3000) return;
      last.current = { text, at: now };
      onCodeRef.current(text);
    };

    async function start() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch (e) {
        const name = (e as { name?: string }).name;
        setStatus(
          name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable',
        );
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const vt = stream.getVideoTracks()[0] ?? null;
      track.current = vt;
      try {
        const caps = vt?.getCapabilities?.() as { torch?: boolean } | undefined;
        setTorchSupported(!!caps?.torch);
      } catch {
        setTorchSupported(false);
      }
      void holdScreen();
      document.addEventListener('visibilitychange', onVisible);
      const el = video.current;
      if (!el) return;
      el.srcObject = stream;
      try {
        await el.play();
      } catch {
        /* autoplay policies: the stream still attaches */
      }
      setStatus('active');

      const BD = (
        window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }
      ).BarcodeDetector;
      const detector = BD ? new BD({ formats: ['qr_code'] }) : null;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const tick = async () => {
        if (stopped) return;
        timer = setTimeout(tick, 160);
        if (pausedRef.current || el.readyState < 2 || !el.videoWidth) return;
        try {
          if (detector) {
            const found = await detector.detect(el);
            if (found[0]?.rawValue) emit(found[0].rawValue);
          } else if (ctx) {
            const scale = Math.min(1, 520 / el.videoWidth);
            canvas.width = Math.round(el.videoWidth * scale);
            canvas.height = Math.round(el.videoHeight * scale);
            ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (hit?.data) emit(hit.data);
          }
        } catch {
          /* a frame that cannot be read is simply skipped */
        }
      };
      void tick();
    }
    void start();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLock?.release().catch(() => undefined);
      track.current = null;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <div className="dd-scanner" data-testid="scanner" data-camera={status}>
      {status === 'denied' || status === 'unavailable' ? (
        <div className="dd-scanner__empty" role="status">
          <Icon name="alert" size={36} />
          <p style={{ margin: 0 }}>
            {status === 'denied' ? t('st.cameraDenied') : t('st.cameraUnavailable')}
          </p>
        </div>
      ) : (
        <>
          <video ref={video} playsInline muted aria-label={t('st.scanHint')} />
          <div className="dd-scanner__frame" aria-hidden="true" />
          {torchSupported ? (
            <button
              type="button"
              className="dd-scanner__torch"
              aria-pressed={torchOn}
              aria-label={torchOn ? t('st.torchOff') : t('st.torchOn')}
              data-testid="torch"
              onClick={() => {
                const next = !torchOn;
                void track.current
                  ?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
                  .then(() => setTorchOn(next))
                  .catch(() => setTorchSupported(false));
              }}
            >
              <Icon name="flame" size={20} />
            </button>
          ) : null}
          <div className="dd-scanner__msg" role="status">
            {status === 'starting' ? t('st.cameraStarting') : t('st.scanHint')}
          </div>
        </>
      )}
    </div>
  );
}

export function ScannerHint({ locale, onManual }: { locale: Locale; onManual: () => void }) {
  const t = createTranslator(locale);
  return (
    <Button variant="outline" block onClick={onManual} data-testid="enter-code">
      <Icon name="keyboard" size={18} /> {t('st.enterCode')}
    </Button>
  );
}
