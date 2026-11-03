export function playbackLifecycle(controls: { isPlaying(): boolean; pause(): void; save(): void; play(): void }) {
  let hidden = false; let resume = false;
  return {
    hide() { if (hidden) return; hidden = true; resume = controls.isPlaying(); controls.pause(); controls.save(); },
    show() { if (!hidden) return; hidden = false; if (resume) { resume = false; controls.play(); } },
  };
}
