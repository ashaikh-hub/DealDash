/**
 * Phone actions shared by the customer screens: the system share sheet (copy-link fallback on browsers without it) and a WhatsApp
 * chat link for a business phone number.
 */
export async function shareLink(input: {
  title: string;
  url: string;
}): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ title: input.title, url: input.url });
      return 'shared';
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(input.url);
      return 'copied';
    }
  } catch (e) {
    // the customer closed the share sheet: not an error worth showing
    if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
  }
  return 'failed';
}

/** wa.me link for a phone number in international form (digits only, no leading zeros or +). Null when there is no number. */
export function whatsappHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^00/, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}
