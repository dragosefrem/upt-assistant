let worker: Promise<ServiceWorkerRegistration> | undefined;

/** Mobile browsers can require a service worker to display an already-authorized notification. */
export async function showDeviceNotice(title: string, body: string, tag: string, href: string) {
  const options = { body, tag, icon: "/images/mascot.svg", data: { href } };
  if ("serviceWorker" in navigator) {
    try {
      worker ??= navigator.serviceWorker.register("/notification-worker.js").then(() => navigator.serviceWorker.ready);
      await (await worker).showNotification(title, options);
      return;
    } catch {
      worker = undefined;
    }
  }
  const notification = new Notification(title, options);
  notification.onclick = () => {
    notification.close();
    window.focus();
    window.location.assign(href);
  };
}
