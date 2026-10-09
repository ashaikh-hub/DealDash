import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Countdown, QrCode, countdownTone, formatRemaining } from './index';

afterEach(() => vi.useRealTimers());

describe('formatRemaining', () => {
  const min = 60_000;
  it('chooses the right unit and keeps Western digits in both languages', () => {
    expect(formatRemaining('en', 2 * 86_400_000 + 5 * 3_600_000)).toBe('2d 5h');
    expect(formatRemaining('en', 3_600_000 + 5 * min)).toBe('1h 05m');
    expect(formatRemaining('en', 12 * min + 30_000)).toBe('12m 30s');
    expect(formatRemaining('en', 45_000)).toBe('45s');
    expect(formatRemaining('en', -5)).toBe('0s');
    expect(formatRemaining('ar', 3_600_000 + 5 * min)).toBe('1 س 05 د');
    expect(formatRemaining('ar', 12 * min)).not.toMatch(/[٠-٩]/);
  });
  it('turns amber in the last hour and red in the last five minutes', () => {
    expect(countdownTone(2 * 3_600_000)).toBe('calm');
    expect(countdownTone(59 * min)).toBe('soon');
    expect(countdownTone(4 * min)).toBe('urgent');
    expect(countdownTone(0)).toBe('over');
  });
});

describe('Countdown follows the SERVER clock, not the phone clock', () => {
  it('a phone that is 10 minutes fast still shows the true time left, and it ticks', () => {
    vi.useFakeTimers();
    const phoneNow = new Date('2026-10-08T12:10:00.000Z'); // the phone clock is 10 minutes ahead
    vi.setSystemTime(phoneNow);
    const serverNow = '2026-10-08T12:00:00.000Z';
    const target = '2026-10-08T12:30:00.000Z';
    render(<Countdown target={target} serverNow={serverNow} locale="en" />);
    expect(screen.getByTestId('countdown')).toHaveTextContent('30m 00s');
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId('countdown')).toHaveTextContent('29m 55s');
  });

  it('shows the ended text once the time has run out and "while stocks last" without a target', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
    const { rerender } = render(
      <Countdown
        target="2026-10-08T11:59:00.000Z"
        serverNow="2026-10-08T12:00:00.000Z"
        locale="en"
      />,
    );
    expect(screen.getByTestId('countdown')).toHaveTextContent('Ended');
    rerender(<Countdown target={null} locale="en" />);
    expect(screen.getByText('While stocks last')).toBeInTheDocument();
  });
});

describe('QrCode', () => {
  it('renders an accessible, dark-on-white SVG that is deterministic and different per payload', () => {
    const { container, rerender } = render(
      <QrCode text="DD1.AbCdEfGhIjKlMnOpQrStUv" label="QR code for your reservation" />,
    );
    const img = screen.getByRole('img', { name: 'QR code for your reservation' });
    expect(img.tagName.toLowerCase()).toBe('svg');
    const path1 = container.querySelector('path')!.getAttribute('d');
    expect(container.querySelector('rect')!.getAttribute('fill')).toBe('#ffffff');
    expect(path1!.length).toBeGreaterThan(200);
    rerender(<QrCode text="DD1.AbCdEfGhIjKlMnOpQrStUv" label="x" />);
    expect(container.querySelector('path')!.getAttribute('d')).toBe(path1);
    rerender(<QrCode text="DD1.ZZZZZZZZZZZZZZZZZZZZZZ" label="x" />);
    expect(container.querySelector('path')!.getAttribute('d')).not.toBe(path1);
  });
});
