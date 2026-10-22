// 进程间消息通道名。主进程与 preload 共享，避免字符串写错。
// invoke/handle 用于请求-响应；send/on 用于单向推送。

export const CH = {
  // 渲染 → 主：请求当前完整快照（请求-响应）。
  getSnapshot: 'req:getSnapshot',
  // 渲染 → 主：读取基础数据（请求-响应）。
  getPreferences: 'req:getPreferences',
  getScheduleSlots: 'req:getScheduleSlots',
  getVisualAssets: 'req:getVisualAssets',
  getRuntimeManifest: 'req:getRuntimeManifest',

  // 主 → 渲染：快照更新广播（带 revision）。
  snapshot: 'push:snapshot',
  // 主 → 气泡窗：气泡文字与存活时长。
  bubble: 'push:bubble',
  // 气泡窗 → 主：页面已注册监听，可以接收文本（握手，避免首次丢字）。
  bubbleReady: 'cmd:bubbleReady',

  // 设置窗 → 主：预览控制与偏好更新（单向）。
  setPreviewMinute: 'cmd:setPreviewMinute',
  clearPreview: 'cmd:clearPreview',
  updatePreferences: 'cmd:updatePreferences',

  // 角色窗 → 主：拖动会话、命中、交互（单向）。
  beginDrag: 'cmd:beginDrag',
  moveDrag: 'cmd:moveDrag',
  endDrag: 'cmd:endDrag',
  setPointerHit: 'cmd:setPointerHit',
  showStatus: 'cmd:showStatus',
  openMenu: 'cmd:openMenu'
} as const;

export type ChannelName = (typeof CH)[keyof typeof CH];
