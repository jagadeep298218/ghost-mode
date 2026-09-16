(() => {
  const downloads = window.GHOST_DOWNLOADS || {};
  const dialog = document.getElementById('mac-download-dialog');
  const status = document.getElementById('mac-download-status');
  document.querySelectorAll('[data-download]').forEach(link => {
    const asset = downloads[link.dataset.download];
    if (asset && asset.available && asset.url) {
      link.href = asset.url;
      link.removeAttribute('aria-disabled');
      if (!/^https?:/.test(asset.url)) link.setAttribute('download', '');
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
    }
  });
  document.querySelectorAll('[data-open-mac]').forEach(button => {
    button.addEventListener('click', () => dialog.showModal());
  });
  document.getElementById('close-mac-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  const available = downloads.macArm64?.available || downloads.macX64?.available;
  status.textContent = available
    ? 'Open the .dmg and drag Ghost Mode into Applications.'
    : 'Mac downloads are not available yet. Please check back soon.';
})();

