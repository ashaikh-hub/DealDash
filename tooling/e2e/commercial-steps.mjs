/**
 * Commercial governance steps shared by the browser scripts (Stage 4, 5, 6 and the commercial script).
 * A campaign cannot be submitted until its owner has reviewed and accepted the commercial terms: the Submit button stays disabled
 * and the review step shows the summary, the acknowledgements and the funding.
 */
export async function acceptCommercial(page, { save } = {}) {
  if (save) await save();
  const form = page.getByTestId('cm-accept-form');
  await form.waitFor({ timeout: 30000 });
  for (const box of await form.getByRole('checkbox').all()) await box.check();
  await page.getByTestId('cm-accept').click();
  await page.getByTestId('cm-accepted-ref').waitFor({ timeout: 30000 });
}

/** Pays what the business owes (development mock) when the panel offers it. */
export async function payCommercial(page) {
  const pay = page.getByTestId('cm-pay');
  if (await pay.count()) {
    await pay.click();
    await page.getByTestId('cm-banner').waitFor({ timeout: 30000 });
  }
}