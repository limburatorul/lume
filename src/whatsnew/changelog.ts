export interface ChangelogEntry {
  version: string
  /** ISO `YYYY-MM-DD`, the day it was released. */
  date: string
  /** Banner headline of the whole x.y release; set on its x.y.0 entry. */
  title?: string
  /** One line each; `**text**` is shown bold. */
  changes: string[]
}

// Newest first. Add a new entry here, with its date, with every version bump;
// a new x.y.0 also gets a title for its What's new banner.
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.5.2',
    date: '2026-10-25',
    changes: [
      'Files, folders and shortcuts you **Pin to Lume** from File Labs’ right-click menu now show up when you type their name, each with its own icon. Pick one and it opens as a double-click would; a folder opens in File Labs.',
      'A new icon, brighter and easier to spot in the taskbar, in the tray and in Settings.',
      'What’s new now shows a picture for each release, at the top of its notes.',
    ],
  },
  {
    version: '0.5.1',
    date: '2026-10-24',
    changes: [
      'Closing the search window with Alt+F4 no longer breaks Lume: the shortcut showed an error ("Object has been destroyed") instead of opening it. Alt+F4 now just hides it, like Esc.'
    ]
  },
  {
    version: '0.5.0',
    date: '2026-10-23',
    title: 'One home for Lume, beside our other apps',
    changes: [
      'Lume now installs for everyone on this PC, in **Program Files\\ProtagonistLabs\\Lume**, next to our other apps. Windows asks for permission when you install and when you update.',
      'Your settings, themes and history move by themselves to **%APPDATA%\\ProtagonistLabs\\Lume**, in one go when you install this version. Nothing is copied twice and nothing is lost.',
      'The old copy in your user folder is removed, with its shortcuts; the new ones are in the Start menu for everyone.',
      'Updates install when you choose **Restart and install**. If you say no to Windows, Lume keeps running and tells you the update waits.',
      'What’s new now counts as read when you close it, so notes you never saw come back next time.',
    ],
  },
  {
    version: '0.4.1',
    date: '2026-10-22',
    changes: [
      'New: **What’s new**, this window. Every release, month by month, built into Lume so it works offline. It opens once after an update, and any time from the tray menu or Settings → About.',
      'Right-click (or Tab) on a result shows its actions — Run as administrator, Open containing folder, Copy path — even when the list is long; the list scrolls to make room.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-10-21',
    title: 'Easier to read, your own accent colour, icons for Windows tools',
    changes: [
      'Easier to read: brighter secondary text and shortcut hints, slightly larger text and icons, and a selected row you can’t miss, even with a busy wallpaper behind the glass.',
      'Pick your **accent colour** in Settings → Appearance: the theme’s, your Windows colour, one of eight presets, or any colour you like.',
      'Index & data shows how many games from Shelf and films from Reel Lume can find.',
      'Icons for everything Explorer shows one for: Control Panel, Run, Task Manager, Remote Desktop, Event Viewer and the other Windows tools, File Explorer, and Xbox games that had none.',
      'Films from Reel show Reel’s icon instead of a folder.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-20',
    title: 'Your Stash backups in the results',
    changes: [
      'With Stash 2.2, type a backup’s date or “Thunderbird backup” and open it in Stash. Backups get their own icon, and About → Works with lists Stash.',
      'Safer launching: Lume only runs results from our other apps that point at a real program on your disk, with sensible arguments, and a crafted name can no longer slip a command into a launch.',
      'With HotkeyScan 1.1.0, Lume tells it which hotkey it holds, so HotkeyScan can name Lume as the owner of Alt+Space.',
    ],
  },
  {
    version: '0.2.2',
    date: '2026-10-17',
    changes: ['The tray menu is in the same order as the other Protagonist Labs apps: Lume’s actions first, then settings and updates, then the website and feedback, then Quit. A waiting update replaces “Check for updates”.'],
  },
  {
    version: '0.2.1',
    date: '2026-10-16',
    changes: [
      'Lume checks for a new version **every hour** instead of every six.',
      'When a check can’t reach GitHub, Settings and the tray say so in one plain sentence instead of a raw error.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-15',
    title: 'Games, films, tasks and folders from our other apps',
    changes: [
      'Games from Shelf, films from Reel, tasks from Planner and folders from File Labs show up in Lume’s results. Press Enter to open them in their app.',
      'If another program has taken Lume’s hotkey, click the notification, or **See who holds it** in Settings: HotkeyScan opens with that combination already checked.',
      'A new **Works with** section in Settings → About.',
      'Program arguments that contain spaces are passed correctly.',
    ],
  },
  {
    version: '0.1.10',
    date: '2026-10-05',
    changes: ['Clicking an action works: right-click a result and Run as administrator, Open containing folder and Copy path all respond to the mouse.'],
  },
  {
    version: '0.1.9',
    date: '2026-10-04',
    changes: ['Clean corners: with the acrylic or mica backdrop, Windows does the rounding, so there is one curve and one border instead of a grey frame with odd corners.'],
  },
  {
    version: '0.1.8',
    date: '2026-10-04',
    changes: [
      'The action menu stays open while the mouse moves, and **Run as administrator** really elevates.',
      'The window appears at once, without Windows’ slow fade and slide.',
      'Drawn icons instead of emoji, in the colour of the text beside them.',
      'Rows say what they are, and the path shows on the selected row.',
      'A finished update says so: a notification to restart into it, and a “Restart and install” entry in the tray.',
    ],
  },
  {
    version: '0.1.7',
    date: '2026-09-27',
    changes: ['The website and More apps links in the tray tell protagonistlabs.app they came from Lume.'],
  },
  {
    version: '0.1.6',
    date: '2026-09-26',
    changes: ['Send feedback, the Lume website and our other apps in the tray menu.'],
  },
  {
    version: '0.1.5',
    date: '2026-09-22',
    changes: [
      'Apps with modern icons no longer show a blank program glyph: Lume reads the icon straight out of the .exe, at up to 256 px.',
      'Shortcuts that name their own icon use it: Chrome web apps, script launchers and GOG games.',
    ],
  },
  {
    version: '0.1.4',
    date: '2026-09-17',
    changes: [
      '**Named custom commands** in Settings → Search: a keyword, a name and a shell command, found like an app.',
      'A new theme, **tinycast**.',
      'Match the Windows accent colour, live.',
      '.url shortcuts (Steam, Ubisoft, GOG and web links) get their own icon.',
    ],
  },
  {
    version: '0.1.3',
    date: '2026-08-25',
    changes: [
      'Ranking learns properly: pick the third result once and it is first for that query from then on.',
      'Anything you have launched outranks something you never have, when the matches are close.',
    ],
  },
  {
    version: '0.1.2',
    date: '2026-08-20',
    changes: ['Lume checks GitHub for updates; the installed version downloads them, verifies them and applies them on the next restart.'],
  },
  {
    version: '0.1.1',
    date: '2026-08-19',
    changes: ['A fresh install explains itself: “Indexing applications…”, then the number of apps to search and the prefixes for the calculator, web search and commands.'],
  },
  {
    version: '0.1.0',
    date: '2026-08-19',
    title: 'Lume',
    changes: [
      'The first release: a keyboard launcher for Windows that you theme in plain CSS.',
      'Press **Alt+Space**, type a few letters, hit Enter. It finds Start Menu and Desktop shortcuts and Store apps, matches them fuzzily, and learns which result you meant.',
      'It also does arithmetic, keyword web searches and shell commands.',
    ],
  },
]
