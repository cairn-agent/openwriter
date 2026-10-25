/**
 * The publish plugin's screens, as an OpenWriter client module (imported at page load): "Your
 * site" and "Publish" in the title bar, the site dashboard in a root of its own beside the app's,
 * followed in the address so /site/<page> opens it and Back closes it, and "Insert block" on the
 * right-click menu. Another client module opens the dashboard with the
 * 'openwriter:open-site' window event ({ detail: { page } }). adr: adr/site-dashboard.md
 */
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { ClientPluginApi, MenuPanelContext } from '@openwriter-src/plugins/client-plugins';
import css from './site.css?inline';
import { setApi } from './bridge';
import { setToast } from './toast';
import { go, navState, reclaimAddress, startNav, useNav, PAGES, type SitePage } from './nav';
import SiteApp from './SiteApp';
import InsertBlockPanel from './InsertBlockPanel';

/** Hand the screens the app's API; also for a module that renders some of them itself. */
export function bindApi(api: ClientPluginApi): void {
  setApi(api);
  setToast(api.showToast);
}

function Overlay() {
  const nav = useNav();
  useEffect(() => {
    document.documentElement.classList.toggle('ow-site-open', nav.open);
  }, [nav.open]);
  return nav.open ? <SiteApp /> : null;
}

export default function activate(api: ClientPluginApi): void {
  bindApi(api);
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  api.registerTopbarButton({ id: 'site', label: 'Your site', title: 'Posts, subscribers, stats and settings for your site', onClick: () => go('home') });
  api.registerTopbarButton({ id: 'publish', label: 'Publish', title: 'Publish this document to your site', onClick: () => go('publish') });

  // Post blocks (paid-only part, callout, poll, file...) as the markers the site reads (blocks.ts).
  api.registerMenuPanel({
    id: 'insert-block',
    label: 'Insert block…',
    mount(el, ctx: MenuPanelContext) {
      const root = createRoot(el);
      root.render(<InsertBlockPanel ctx={ctx} />);
      return { unmount: () => root.unmount() };
    },
  });

  window.addEventListener('openwriter:open-site', (e) => {
    const page = (e as CustomEvent<{ page?: string }>).detail?.page;
    go((PAGES as readonly string[]).includes(page || '') ? page as SitePage : 'home');
  });

  const host = document.createElement('div');
  host.id = 'ow-site-root';
  document.body.appendChild(host);
  createRoot(host).render(<StrictMode><Overlay /></StrictMode>);
  startNav();
  // Opened by a reload on /site/...: once the app has written its document's address, take ours back.
  if (navState().open) {
    const stop = api.onAppChange(() => {
      if (!api.getApp().filename) return;
      stop();
      setTimeout(reclaimAddress, 0);
    });
  }
}
