/** Present application metadata in a modal and route links through the desktop service. */
export class AboutDialog {
  constructor(openLink, notifyError, copyContact) {
    this.dialog = document.querySelector('#about-dialog');
    this.button = document.querySelector('#app-about');
    for (const button of this.dialog.querySelectorAll('[data-about-close]')) button.addEventListener('click',() => this.dialog.close());
    this.dialog.addEventListener('close',() => this.button.focus({preventScroll:true}));
    for (const link of this.dialog.querySelectorAll('[data-app-link]')) link.addEventListener('click',event => {
      event.preventDefault();
      openLink(link.dataset.appLink).catch(notifyError);
    });
    for (const button of this.dialog.querySelectorAll('[data-app-copy]')) button.addEventListener('click',async () => {
      button.disabled = true;
      try {
        await copyContact(button.dataset.appCopy);
        const icon = button.querySelector('span');
        const label=button.dataset.copyLabel ??= button.getAttribute('aria-label');
        icon.textContent = 'check';
        button.setAttribute('aria-label','Copied');
        clearTimeout(button.copyTimer);
        button.copyTimer = setTimeout(() => {
          icon.textContent = 'content_copy';
          button.setAttribute('aria-label',label);
        },1500);
      } catch (error) { notifyError(error); }
      finally { button.disabled = false; }
    });
  }

  /** Open immediately, then fill trusted host metadata without interpreting it as markup. */
  async open(loadInfo) {
    if (this.dialog.open) return;
    const error = this.dialog.querySelector('.modal-error');
    error.hidden = true;
    this.dialog.showModal();
    try {
      const info = await loadInfo();
      for (const field of this.dialog.querySelectorAll('[data-app-info]')) field.textContent = info[field.dataset.appInfo];
      const date = this.dialog.querySelector('time');
      date.dateTime = info.lastUpdated;
      date.textContent = new Intl.DateTimeFormat(undefined,{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'})
        .format(new Date(`${info.lastUpdated}T00:00:00Z`));
      for (const link of this.dialog.querySelectorAll('[data-app-link]')) {
        const key = link.dataset.appLink;
        link.href = key === 'email' ? `mailto:${info.email}` : info[key];
        link.textContent = info[key];
      }
    } catch (failure) {
      error.textContent = `Could not load application details: ${failure.message}`;
      error.hidden = false;
    }
  }
}
