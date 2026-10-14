import './accessibility.css';

// Keyboard and screen-reader improvements: a skip link, a shared Escape key, and an accessible
// name for every button and input that doesn't have one. Runs again when the page changes.
export default function initAccessibility({ elements }) {
  const { messageList } = elements;

  // Skip link: lets a keyboard user jump past the sidebar straight to the messages.
  const skip = document.createElement('a');
  skip.href = '#message-list';
  skip.className = 'skip-link';
  skip.textContent = 'Skip to messages';
  document.body.prepend(skip);
  messageList.setAttribute('tabindex', '-1');
  messageList.setAttribute('aria-label', 'Messages');

  // Every control needs a name a screen reader can announce.
  function nameControls() {
    document.querySelectorAll('button:not([aria-label])').forEach((button) => {
      const text = button.textContent.trim();
      const name = text || button.title;
      if (name) button.setAttribute('aria-label', name);
    });
    document.querySelectorAll('input:not([aria-label])').forEach((input) => {
      const labelled = input.id && document.querySelector(`label[for="${input.id}"]`);
      const name = labelled ? '' : input.placeholder;
      if (name) input.setAttribute('aria-label', name);
    });
  }

  // Escape closes whatever panel is open: search results, or a direct-message conversation.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const search = document.querySelector('.search-results:not([hidden]) .search-close');
    const dm = document.querySelector('.dm-view:not([hidden]) .dm-back');
    const target = search || dm;
    if (target) {
      event.preventDefault();
      target.click();
    }
  });

  nameControls();
  new MutationObserver(nameControls).observe(document.body, { childList: true, subtree: true });
}
