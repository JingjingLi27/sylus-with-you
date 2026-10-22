// 气泡窗渲染进程：接收主进程推送的文字，淡入显示约 ttl 毫秒后淡出。
// 气泡不接收鼠标（主进程已设 setIgnoreMouseEvents）；文案完全由主进程生成。
// 注册监听后向主进程发 ready，确保主进程在页面就绪后才发送文本，首次不丢字。

const bubbleEl = document.getElementById('bubble') as HTMLDivElement;
let hideTimer = 0;

function show(text: string, ttlMs: number): void {
  // 每次都替换为最新文本并重置计时，快速连点只显示最新内容。
  bubbleEl.textContent = text;
  bubbleEl.classList.add('visible');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    bubbleEl.classList.remove('visible');
  }, Math.max(0, ttlMs - 300));
}

window.companion.onBubble((text, ttlMs) => show(text, ttlMs));
// 监听注册完成后再通知主进程，可以安全发送。
window.companion.bubbleReady();
