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
 * Opens the share in a Document Picture-in-Picture window. The window gets
 * the page's styles and follows its theme; `onclosed` runs however it
 * closes (our close, its own close button, or the page going away).
 */
export async function popOutWindow(props: SharePopoutProps, onclosed: () => void): Promise<Popout> {
  const pip = (window as Window & { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture!;
  const popup = await pip.requestWindow({ width: 800, height: 500 });
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
    // Unmounting detaches the share from the window's <video>.
    void unmount(app);
    onclosed();
  };
  popup.addEventListener('pagehide', teardown, { once: true });

  return {
    close() {
      teardown();
      popup.close();
    }
  };
}
