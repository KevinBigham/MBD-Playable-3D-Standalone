import './style.css';
import { App } from './ui/app';

/**
 * Entry point. Boots the app, hides the loading card once the first frame has
 * actually been drawn, and installs global handlers so an unexpected failure
 * shows a readable message instead of a black rectangle.
 */

function fail(message: string, detail?: unknown): void {
  console.error('[MOONSHOT NINE]', message, detail);
  const boot = document.getElementById('boot');
  if (boot) {
    boot.classList.remove('hidden');
    boot.innerHTML = `
      <div class="boot-mark">MOONSHOT<span>NINE</span></div>
      <div class="boot-note" style="color:#ff5f6d;max-width:60ch;text-align:center;letter-spacing:.08em">
        ${message}
      </div>`;
  }
}

function boot(): void {
  const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
  const ui = document.getElementById('ui') as HTMLDivElement | null;
  if (!canvas || !ui) {
    fail('The page did not load correctly. Try a hard refresh.');
    return;
  }

  let app: App;
  try {
    app = new App(canvas, ui);
  } catch (err) {
    fail(
      'This browser could not start WebGL. MOONSHOT NINE needs a current version of Chrome, Edge or Safari with hardware acceleration enabled.',
      err,
    );
    return;
  }

  app.start();
  (window as unknown as { moonshot?: App }).moonshot = app;

  // Only hide the loading card once a frame has genuinely rendered.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.getElementById('boot')?.classList.add('hidden');
    }),
  );
}

window.addEventListener('error', (e) => {
  if (!document.getElementById('boot')?.classList.contains('hidden')) {
    fail('Something went wrong while starting up.', e.error);
  }
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[MOONSHOT NINE] unhandled promise rejection', e.reason);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
