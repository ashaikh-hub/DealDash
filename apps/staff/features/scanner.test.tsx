import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraScanner } from './scanner';

function fakeCamera(opts: { torch: boolean }) {
  const applyConstraints = vi.fn(async () => undefined);
  const track = {
    stop: vi.fn(),
    getCapabilities: () => (opts.torch ? { torch: true } : {}),
    applyConstraints,
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never; // jsdom has no canvas
  return { applyConstraints, track };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'wakeLock');
});

describe('camera scanner progressive enhancement', () => {
  it('shows a torch control only where the camera supports it, and toggles it', async () => {
    const cam = fakeCamera({ torch: true });
    render(<CameraScanner locale="en" paused={false} onCode={() => undefined} />);
    const torch = await screen.findByTestId('torch');
    expect(torch).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(torch);
    await waitFor(() => expect(torch).toHaveAttribute('aria-pressed', 'true'));
    expect(cam.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(torch).toHaveAccessibleName('Turn light off');
  });

  it('has no torch control when unsupported, and scanning still starts', async () => {
    fakeCamera({ torch: false });
    render(<CameraScanner locale="en" paused={false} onCode={() => undefined} />);
    await waitFor(() =>
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-camera', 'active'),
    );
    expect(screen.queryByTestId('torch')).toBeNull();
  });

  it('keeps the screen awake while scanning, releases it on leave, and works when wake lock is missing or refused', async () => {
    fakeCamera({ torch: false });
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const { unmount } = render(
      <CameraScanner locale="en" paused={false} onCode={() => undefined} />,
    );
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    unmount();
    expect(release).toHaveBeenCalled();

    // refused: the camera still becomes active (core journey is never blocked)
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) },
    });
    render(<CameraScanner locale="en" paused={false} onCode={() => undefined} />);
    await waitFor(() =>
      expect(screen.getAllByTestId('scanner').at(-1)).toHaveAttribute('data-camera', 'active'),
    );
  });
});
