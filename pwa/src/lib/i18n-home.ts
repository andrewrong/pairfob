/** Home surface copy: the view switch, summary line, layout view and scoped menus. */
export const zhHome = {
  "home.computerAria": "当前电脑：{status}。点按切换电脑",
  "home.viewAria": "首页视图",
  "home.viewList": "列表",
  "home.viewLayout": "布局",
  "home.sessionCount": "{count} 个会话",
  "home.grouping": "分组：{name}",
  "home.tabCount": "{count} 个标签页",
  "home.layoutHint": "点格子打开会话；点标签页名称查看可缩放的完整布局。",
  "menu.more": "更多",
  "menu.scopeAria": "操作对象",
  "menu.scopePane": "会话",
  "menu.scopeTab": "标签页",
  "menu.scopeWorkspace": "工作区",
} as const;

export const enHome: Record<keyof typeof zhHome, string> = {
  "home.computerAria": "Current computer: {status}. Tap to switch computers",
  "home.viewAria": "Home view",
  "home.viewList": "List",
  "home.viewLayout": "Layout",
  "home.sessionCount": "{count} sessions",
  "home.grouping": "Group: {name}",
  "home.tabCount": "{count} tabs",
  "home.layoutHint": "Tap a pane to open it; tap a tab name for its full, zoomable layout.",
  "menu.more": "More",
  "menu.scopeAria": "Actions for",
  "menu.scopePane": "Session",
  "menu.scopeTab": "Tab",
  "menu.scopeWorkspace": "Workspace",
};
