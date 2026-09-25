let lastReportedId = '';
let lastDurationId = '';

function videoId() {
  const url = new URL(location.href);
  if (url.pathname === '/watch') return url.searchParams.get('v');
  const match = url.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/);
  return match?.[1];
}

function checkProgress(event) {
  const video = event.target;
  if (!(video instanceof HTMLVideoElement) || !Number.isFinite(video.duration) || video.duration <= 0) return;
  if (video.closest('.ad-showing') || document.querySelector('.html5-video-player.ad-showing')) return;
  const id = videoId();
  if (!id || !/^[\w-]{11}$/.test(id)) return;
  if (id !== lastDurationId) {
    lastDurationId = id;
    chrome.runtime.sendMessage({ type: 'duration', videoId: id, duration: video.duration }).catch(() => {});
  }
  if (id === lastReportedId) return;
  if (video.currentTime / video.duration >= 0.8) {
    lastReportedId = id;
    chrome.runtime.sendMessage({ type: 'watched', videoId: id }).catch(() => {});
  }
}

document.addEventListener('timeupdate', checkProgress, true);
document.addEventListener('loadedmetadata', checkProgress, true);
