import { mount, unmount, type ComponentProps } from 'svelte';
import SharePopout from './SharePopout.svelte';

type SharePopoutProps = ComponentProps<typeof SharePopout>;

/**
 * How this browser can lift a screen share out of the page: a whole small
 * window of our own (Document Picture-in-Picture, desktop Chromium), the
 * video alone in the system's picture-in-picture, or WebKit's older
 * presentation mode for the same (iPadOS Safari before the standard API).
 */
export type PopoutMethod = 'document' | 'video' | 'webkit';

interface DocumentPictureInPicture {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

type WebKitVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
};

export function popoutMethod(): PopoutMethod | undefined {
  if (typeof window === 'undefined') return undefined;
  if ('documentPictureInPicture' in window) return 'document';
  if (document.pictureInPictureEnabled && 'requestPictureInPicture' in HTMLVideoElement.prototype) {
    return 'video';
  }
  if ('webkitSetPresentationMode' in HTMLVideoElement.prototype) return 'webkit';
  return undefined;
}

/** The share's own <video> into the system's picture-in-picture window. */
export async function popOutVideo(video: HTMLVideoElement, method: PopoutMethod): Promise<void> {
  if (method === 'video') {
    await video.requestPictureInPicture();
    return;
  }
  const webkit = video as WebKitVideo;
  if (webkit.webkitSupportsPresentationMode?.('picture-in-picture')) {
    webkit.webkitSetPresentationMode?.('picture-in-picture');
  }
}

export interface Popout {
  close(): void;
}

/**
 * Gives a popup window the page's styles and theme and mounts the share in
 * it; `onclosed` runs however it closes (our close, its own close button, or
 * the page going away).
 */
function mountPopout(popup: Window, props: SharePopoutProps, onclosed: () => void): Popout {
  const doc = popup.document;

  for (const sheet of document.styleSheets) {
    // A linked sheet is linked again, so its fonts resolve against its own URL.
    if (sheet.href) {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      doc.head.append(link);
    } else {
      const style = doc.createElement('style');
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
      doc.head.append(style);
    }
  }

  const followTheme = () => {
    const theme = document.documentElement.dataset.theme;
    if (theme) doc.documentElement.dataset.theme = theme;
  };
  followTheme();
  const themeWatch = new MutationObserver(followTheme);
  themeWatch.observe(document.documentElement, { attributeFilter: ['data-theme'] });

  const app = mount(SharePopout, { target: doc.body, props });
  let open = true;

  const teardown = () => {
    if (!open) return;
    open = false;
    themeWatch.disconnect();
    window.removeEventListener('pagehide', closeWithPage);
    // Unmounting detaches the share from the window's <video>.
    void unmount(app);
    onclosed();
  };
  const closeWithPage = () => {
    teardown();
    popup.close();
  };
  popup.addEventListener('pagehide', teardown, { once: true });
  window.addEventListener('pagehide', closeWithPage);

  return {
    close() {
      teardown();
      popup.close();
    }
  };
}

/** Opens the share in a Document Picture-in-Picture window. */
export async function popOutWindow(props: SharePopoutProps, onclosed: () => void): Promise<Popout> {
  const pip = (window as Window & { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture!;
  // A third of the screen wide, a 16:9 share tall, plus the header, gap and padding.
  const width = Math.max(360, Math.round(screen.availWidth / 3));
  const height = Math.round((width - 20) * (9 / 16)) + 30 + 10 + 20;
  const popup = await pip.requestWindow({ width, height });
  return mountPopout(popup, props, onclosed);
}

/**
 * Opens the share in an ordinary browser popup the user can resize, maximise
 * or move to another monitor. Call it straight from a click so popup
 * blockers allow it.
 */
export async function popOutTab(props: SharePopoutProps, onclosed: () => void): Promise<Popout> {
  const popup = window.open('/share-window.html', 'tide-share', 'popup,width=960,height=600');
  if (!popup) throw new Error('The browser blocked the window');

  // window.open starts on an about:blank document that the real one replaces;
  // mounting or listening before then would be lost with it.
  const deadline = Date.now() + 5000;
  while (popup.location.href === 'about:blank' || popup.document.readyState !== 'complete') {
    if (popup.closed || Date.now() > deadline) {
      popup.close();
      throw new Error('The window did not load');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return mountPopout(popup, props, onclosed);
}
