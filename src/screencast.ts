import { Page, CDPSession } from 'playwright';

export async function startScreencast(
  page: Page,
  onFrame: (jpegBase64: string) => void
): Promise<() => void> {
  const client: CDPSession = await page.context().newCDPSession(page);

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 60,
    maxWidth: 1280,
    maxHeight: 800,
    everyNthFrame: 2,
  });

  client.on('Page.screencastFrame', async (evt) => {
    onFrame(evt.data);
    await client.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => {});
  });

  return async () => {
    await client.send('Page.stopScreencast').catch(() => {});
    await client.detach().catch(() => {});
  };
}
