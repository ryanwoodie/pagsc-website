import { track } from './track';

// Progressive enhancement for forms that post to the Apps Script endpoint.
// Without JavaScript the browser posts and the script redirects. With it, we post in
// the background and go to the "next" page; if the endpoint cannot be reached, the
// form's .form-error message (club email and phone) is shown instead.
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-endpoint]')) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const error = form.querySelector<HTMLElement>('.form-error')!;
    button.disabled = true;
    error.hidden = true;
    try {
      await fetch(form.dataset.endpoint!, {
        method: 'POST',
        mode: 'no-cors',
        body: new URLSearchParams(new FormData(form) as unknown as Record<string, string>),
      });
      const kind = (form.querySelector<HTMLInputElement>('input[name="form"]')?.value) || 'form';
      track(kind === 'pack' ? 'welcome-pack/request' : `booking/form/${kind}`);
      // give the count a moment to send before leaving the page
      setTimeout(() => (window.location.href = form.dataset.next!), 150);
    } catch {
      error.hidden = false;
      button.disabled = false;
      error.focus();
    }
  });
}
